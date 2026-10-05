import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// eslint-disable-next-line n/no-missing-import -- the file is there; the rule can't resolve a .mjs outside src/
import { compareVersions, parseVersion } from '../../scripts/semver.mjs'

// The release scripts follow Bitfocus's release process: bump the version in one commit, merge it, then tag that commit,
// because their checks compare the tag against package.json. These run the real scripts against throwaway git
// repositories, never this one.

const repo = fileURLToPath(new URL('../../', import.meta.url))
const scripts = (name: string) => path.join(repo, 'scripts', name)

const FILES = ['package.json', 'companion/manifest.json', 'touchpoint/CompanionMeetings.py', 'src/scriptSource.ts']

let project: string

const git = (...args: string[]) => execFileSync('git', args, { cwd: project, encoding: 'utf8' }).trim()
const read = (file: string) => readFileSync(path.join(project, file), 'utf8')

type Outcome = { ok: boolean; output: string }

/** Runs one of the scripts in the throwaway project, returning what it printed rather than throwing if it fails. */
function run(script: string, ...args: string[]): Outcome {
	try {
		const output = execFileSync(process.execPath, [scripts(script), ...args, '--root', project], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		})
		return { ok: true, output }
	} catch (e) {
		const failure = e as { stdout?: string; stderr?: string }
		return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
	}
}

beforeEach(() => {
	project = mkdtempSync(path.join(tmpdir(), 'tpmeetings-release-'))
	for (const file of FILES) {
		mkdirSync(path.dirname(path.join(project, file)), { recursive: true })
		const text = readFileSync(path.join(repo, file), 'utf8').replace(/\r\n/g, '\n')
		writeFileSync(path.join(project, file), text)
	}

	git('init', '-q', '-b', 'main')
	git('config', 'user.name', 'Test')
	git('config', 'user.email', 'test@example.org')
	git('config', 'core.autocrlf', 'false')
	git('config', 'commit.gpgsign', 'false')
	git('config', 'core.hooksPath', 'no-hooks-here') // not this repository's hooks
	git('add', '.')
	git('commit', '-q', '-m', 'Start')
})

afterEach(() => {
	rmSync(project, { recursive: true, force: true })
})

/** The version the project starts at: whatever this repository's is. */
const startVersion = () => JSON.parse(read('package.json')).version as string

describe('yarn release (prepares a release)', () => {
	it('puts the version everywhere, in a commit of only that, on a release branch', () => {
		const result = run('release.mjs', '9.8.7')

		expect(result.ok, result.output).toBe(true)
		expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('release/v9.8.7')
		expect(git('log', '-1', '--format=%s')).toBe('Release v9.8.7')
		expect(git('show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual([...FILES].sort())
		expect(git('status', '--porcelain')).toBe('')

		expect(JSON.parse(read('package.json')).version).toBe('9.8.7')
		expect(JSON.parse(read('companion/manifest.json')).version).toBe('9.8.7')
		expect(read('touchpoint/CompanionMeetings.py')).toContain('VERSION = "9.8.7"')
		expect(read('src/scriptSource.ts')).toContain('MODULE_VERSION = "9.8.7"')
	})

	it('changes nothing else in the files it edits', () => {
		const before = read('package.json').split('\n')
		run('release.mjs', '9.8.7')
		const after = read('package.json').split('\n')

		expect(after).toHaveLength(before.length)
		expect(after.filter((line, i) => line !== before[i])).toEqual(['\t"version": "9.8.7",'])
	})

	it('says what to do next, including tagging after the merge', () => {
		const { output } = run('release.mjs', 'v9.8.7')

		expect(output).toContain('git push -u origin release/v9.8.7')
		expect(output).toContain('yarn release:tag')
		expect(output).toContain('Developer Portal')
	})

	it('takes a pre-release version, or a tag name', () => {
		expect(run('release.mjs', 'v9.8.7-beta.1').ok).toBe(true)
		expect(JSON.parse(read('package.json')).version).toBe('9.8.7-beta.1')
	})

	it('can commit on the current branch instead', () => {
		const result = run('release.mjs', '9.8.7', '--no-branch')

		expect(result.ok, result.output).toBe(true)
		expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
		expect(git('log', '-1', '--format=%s')).toBe('Release v9.8.7')
	})

	describe('refuses, changing nothing,', () => {
		const unchanged = () => {
			expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
			expect(git('log', '--format=%s')).toBe('Start')
			expect(JSON.parse(read('package.json')).version).toBe(startVersion())
		}

		it.each(['1.2', 'latest', 'v1.2.x', ''])('for something that is not a version: %j', (bad) => {
			const result = bad ? run('release.mjs', bad) : run('release.mjs')
			expect(result.ok).toBe(false)
			unchanged()
		})

		it('for a version that is not newer, which is probably a typo', () => {
			const current = startVersion()
			for (const version of [current, '0.0.1', `${current}-beta.1`]) {
				const result = run('release.mjs', version)
				expect(result.ok, version).toBe(false)
				expect(result.output).toContain('is not newer')
			}
			unchanged()
		})

		it('when there are uncommitted changes', () => {
			writeFileSync(path.join(project, 'README.md'), 'changed')
			git('add', 'README.md')

			const result = run('release.mjs', '9.8.7')
			expect(result.ok).toBe(false)
			expect(result.output).toContain('uncommitted changes')
			expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
		})

		it('when the tag already exists', () => {
			git('tag', 'v9.8.7')

			const result = run('release.mjs', '9.8.7')
			expect(result.ok).toBe(false)
			expect(result.output).toContain('already exists')
			unchanged()
		})

		it('when the release branch already exists', () => {
			git('branch', 'release/v9.8.7')

			const result = run('release.mjs', '9.8.7')
			expect(result.ok).toBe(false)
			expect(result.output).toContain('already exists')
			unchanged()
		})
	})
})

describe('yarn release:tag (tags a release)', () => {
	const merged = (version = '9.8.7') => {
		// What the real process leaves on main: the release commit, merged.
		expect(run('release.mjs', version, '--no-branch').ok).toBe(true)
	}

	it('tags the commit with the version that is in the files, as an annotated tag', () => {
		merged()

		const result = run('tag-release.mjs')
		expect(result.ok, result.output).toBe(true)
		expect(result.output).toContain('git push origin v9.8.7')

		expect(git('tag')).toBe('v9.8.7')
		expect(git('cat-file', '-t', 'v9.8.7')).toBe('tag')
		expect(git('rev-parse', 'v9.8.7^{commit}')).toBe(git('rev-parse', 'HEAD'))
	})

	it('is the tag that Bitfocus’s checks expect: v + the version in package.json', () => {
		merged('9.8.7-beta.2')
		run('tag-release.mjs')
		expect(git('tag')).toBe(`v${JSON.parse(read('package.json')).version}`)
	})

	describe('refuses, tagging nothing,', () => {
		it('when the versions are not the same everywhere, and says which', () => {
			const manifest = JSON.parse(read('companion/manifest.json'))
			manifest.version = '0.0.9'
			writeFileSync(path.join(project, 'companion/manifest.json'), JSON.stringify(manifest, null, '\t') + '\n')
			git('commit', '-q', '-am', 'Drift')

			const result = run('tag-release.mjs')
			expect(result.ok).toBe(false)
			expect(result.output).toContain('companion/manifest.json says 0.0.9')
			expect(result.output).toContain('yarn release')
			expect(git('tag')).toBe('')
		})

		it('when the script’s version is the one that is out of step', () => {
			const script = read('touchpoint/CompanionMeetings.py').replace(/^VERSION = ".*"$/m, 'VERSION = "0.0.9"')
			writeFileSync(path.join(project, 'touchpoint/CompanionMeetings.py'), script)
			git('commit', '-q', '-am', 'Drift')

			const result = run('tag-release.mjs')
			expect(result.ok).toBe(false)
			expect(result.output).toContain("touchpoint/CompanionMeetings.py's VERSION says 0.0.9")
		})

		it('on a release branch, which is not merged yet', () => {
			expect(run('release.mjs', '9.8.7').ok).toBe(true) // leaves us on release/v9.8.7

			const result = run('tag-release.mjs')
			expect(result.ok).toBe(false)
			expect(result.output).toContain('not main')
			expect(git('tag')).toBe('')
		})

		it('when there are uncommitted changes', () => {
			merged()
			writeFileSync(path.join(project, 'package.json'), read('package.json') + ' ')

			const result = run('tag-release.mjs')
			expect(result.ok).toBe(false)
			expect(result.output).toContain('uncommitted changes')
		})

		it('when the tag exists already, and never moves it', () => {
			merged()
			expect(run('tag-release.mjs').ok).toBe(true)
			const tagged = git('rev-parse', 'v9.8.7')

			writeFileSync(path.join(project, 'README.md'), 'more')
			git('add', 'README.md')
			git('commit', '-q', '-m', 'More')

			const result = run('tag-release.mjs')
			expect(result.ok).toBe(false)
			expect(result.output).toContain('never moved')
			expect(git('rev-parse', 'v9.8.7')).toBe(tagged)
		})
	})
})

describe('set-version, on its own', () => {
	it.each(['9.8.7', 'v9.8.7', 'refs/tags/v9.8.7'])('accepts %s', (given) => {
		expect(run('set-version.mjs', given).ok).toBe(true)
		expect(JSON.parse(read('package.json')).version).toBe('9.8.7')
	})

	it('does not commit or tag anything', () => {
		run('set-version.mjs', '9.8.7')
		expect(git('log', '--format=%s')).toBe('Start')
		expect(git('tag')).toBe('')
		expect(git('status', '--porcelain')).not.toBe('')
	})

	it('can be run again for the same version, changing nothing more', () => {
		run('set-version.mjs', '9.8.7')
		const once = FILES.map(read)
		run('set-version.mjs', '9.8.7')
		expect(FILES.map(read)).toEqual(once)
	})

	it.each(['1.2', 'v1', 'x', 'v1.2.3.4'])('rejects %s, changing nothing', (bad) => {
		const result = run('set-version.mjs', bad)
		expect(result.ok).toBe(false)
		expect(result.output).toContain('is not a version')
		expect(git('status', '--porcelain')).toBe('')
	})

	it('leaves the working project in step with itself, which the version tests check', () => {
		run('set-version.mjs', '9.8.7-rc.1')
		const versions = [
			JSON.parse(read('package.json')).version,
			JSON.parse(read('companion/manifest.json')).version,
			/^VERSION = "([^"]*)"/m.exec(read('touchpoint/CompanionMeetings.py'))?.[1],
			/MODULE_VERSION = "([^"]*)"/.exec(read('src/scriptSource.ts'))?.[1],
		]
		expect(new Set(versions)).toEqual(new Set(['9.8.7-rc.1']))
	})
})

describe('the release scripts’ own version comparison', () => {
	// The third place versions are compared, after the module and the TouchPoint script: all are held to the same cases.
	const cases = JSON.parse(readFileSync(path.join(repo, 'test/fixtures/version-comparisons.json'), 'utf8')) as {
		valid: string[]
		invalid: string[]
		comparisons: [string, string, number][]
	}

	it('agrees about what is a version', () => {
		for (const text of cases.valid) expect(parseVersion(text), text).toBeDefined()
		for (const text of cases.invalid) expect(parseVersion(text), JSON.stringify(text)).toBeUndefined()
	})

	it('agrees about which is newer', () => {
		for (const [a, b, expected] of cases.comparisons) {
			expect(Math.sign(compareVersions(parseVersion(a)!, parseVersion(b)!)), `${a} against ${b}`).toBe(expected)
		}
	})

	it('has the files it needs in this repository', () => {
		for (const file of FILES) expect(existsSync(path.join(repo, file)), file).toBe(true)
	})
})
