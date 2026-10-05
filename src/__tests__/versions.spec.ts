import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MODULE_VERSION, REPOSITORY_URL, SCRIPT_PATH, SCRIPT_SOURCE } from '../scriptSource.js'
import { parseVersion } from '../version.js'

// The module is made of several things that each carry a version or an address, and have to agree: the package and the
// manifest, the TouchPoint script and its copy inside the module, the tag that the settings link to, CI, and the docs.
// The module and the TouchPoint script are one thing with one version, the package's: they are released together, so
// a new version of one is a new version of the other. These tests are what keep everything in step. When one fails,
// the message says what to change.

const root = new URL('../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n')
const json = (path: string) => JSON.parse(read(path)) as Record<string, any>

const packageJson = json('package.json')
const manifest = json('companion/manifest.json')
const script = read(SCRIPT_PATH)
const scriptVersion = /^VERSION = "([^"]+)"/m.exec(script)?.[1]

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/
const repositoryAddress = (url: string) => url.replace(/^git\+/, '').replace(/\.git$/, '')

const workflows = ['node.yaml', 'tests.yml', 'build.yml'].map((name) => ({
	name,
	text: read(`.github/workflows/${name}`),
}))

describe('the module’s version', () => {
	it('is a version number', () => {
		expect(packageJson.version).toMatch(SEMVER)
	})

	it('is one that the module and the TouchPoint script can compare', () => {
		// The script is only updated to a version that is newer, so both have to understand this one.
		expect(parseVersion(packageJson.version)).toBeDefined()
	})

	it('is the same in package.json and companion/manifest.json', () => {
		expect(manifest.version).toBe(packageJson.version)
	})

	it('is the one the module was prepared with (run `npm run embed` after changing the version)', () => {
		expect(MODULE_VERSION).toBe(packageJson.version)
	})

	it('names a release tag that the repository’s workflows build', () => {
		// GitHub's tag filters: "+" means one or more of the character before it, and "*" means anything but "/".
		const filter = /tags:\s*\n\s*-\s*'([^']+)'/.exec(read('.github/workflows/node.yaml'))?.[1]
		expect(filter, 'node.yaml has no tag filter').toBeDefined()

		const pattern = new RegExp('^' + filter!.replace(/\./g, '\\.').replace(/\*/g, '[^/]*') + '$')
		expect(`v${MODULE_VERSION}`).toMatch(pattern)
	})

	// Bitfocus's release checks compare the tag against package.json, so the version has to be in the commit that gets
	// tagged. `yarn release` sets it, and `yarn release:tag` makes the tag from it. This catches a tag made any other way
	// (such as in GitHub's "create release" page, from a commit that didn't have the version bumped), with the fix.
	it.runIf(process.env.GITHUB_REF_TYPE === 'tag')('is the version of the tag being built', () => {
		expect(
			process.env.GITHUB_REF_NAME,
			`This tag doesn't match the version in package.json (${packageJson.version}). Tags have to be made from a commit ` +
				'that already has its version: use `yarn release <version>`, merge it, then `yarn release:tag`. ' +
				'Delete this tag (git push --delete origin <tag>) once it is safe to, before making the right one.',
		).toBe(`v${packageJson.version}`)
	})

	it('is checked on tag pushes, by the tests workflow', () => {
		// "push:" with no branch filter runs for every push, tags included.
		const trigger = /^on:\s*\n([\s\S]*?)^jobs:/m.exec(read('.github/workflows/tests.yml'))?.[1] ?? ''
		expect(trigger).toMatch(/^ {2}push:\s*$/m)
		expect(trigger).not.toMatch(/branches|tags-ignore/)
	})
})

describe('the TouchPoint script’s version', () => {
	it('is the module’s version: they are one thing, with one version (run `npm run embed`)', () => {
		expect(scriptVersion).toBe(packageJson.version)
	})

	it('is the one in the copy embedded in the module (run `npm run embed`)', () => {
		expect(SCRIPT_SOURCE).toBe(script)
		expect(SCRIPT_SOURCE).toContain(`VERSION = "${MODULE_VERSION}"`)
	})

	it('is set by the module’s build, which embeds the script', () => {
		expect(packageJson.scripts.build).toContain('npm run embed')
		expect(packageJson.scripts.dev).toContain('npm run embed')
	})

	it('is checked for being out of date in CI, which fails if `npm run embed` would change anything', () => {
		const tests = read('.github/workflows/tests.yml')
		const check = /yarn embed\s+git diff --exit-code ([^\n]+)/.exec(tests)?.[1] ?? ''
		expect(check).toContain('src/scriptSource.ts')
		expect(check).toContain(SCRIPT_PATH)
	})
})

describe('the repository’s address', () => {
	const expected = REPOSITORY_URL

	it('is the same in package.json and companion/manifest.json', () => {
		expect(repositoryAddress(packageJson.repository.url)).toBe(expected)
		expect(repositoryAddress(manifest.repository)).toBe(expected)
	})

	it('is where bug reports go', () => {
		expect(manifest.bugs).toBe(`${expected}/issues`)
	})

	it('is where the script says it comes from', () => {
		expect(script).toContain(`# Source: ${expected}/blob/main/${SCRIPT_PATH}`)
	})

	it('is the only repository the documentation links to', () => {
		for (const file of ['README.md', 'companion/HELP.md']) {
			const addresses = [
				...read(file).matchAll(/https:\/\/github\.com\/[^/\s)]+\/companion-module-touchpoint-meetings/g),
			]
			expect(new Set(addresses.map((m) => m[0])), file).toEqual(addresses.length ? new Set([expected]) : new Set())
		}
	})
})

describe('the module’s name', () => {
	it('is the same in package.json and the manifest', () => {
		expect(packageJson.name).toBe(manifest.id)
	})

	it('is the repository’s name, without the "companion-module-" prefix', () => {
		expect(REPOSITORY_URL.endsWith(`/companion-module-${manifest.id}`)).toBe(true)
	})
})

describe('the tools the module is built with', () => {
	const major = (range: string) => /\d+/.exec(range)?.[0]

	it('are the same Node.js version in package.json, the manifest, and every workflow', () => {
		const node = major(packageJson.engines.node)
		expect(manifest.runtime.type).toBe(`node${node}`)

		for (const { name, text } of workflows) {
			const used = [...text.matchAll(/node-version:\s*'?(\d+)/g)].map((m) => m[1])
			expect(used.length, `${name} doesn't say which Node.js to use`).toBeGreaterThan(0)
			for (const version of used) expect(version, name).toBe(node)
		}
	})

	it('are the same Yarn version in package.json’s packageManager and engines', () => {
		expect(major(packageJson.packageManager.replace(/^yarn@/, ''))).toBe(major(packageJson.engines.yarn))
	})
})

describe('the documentation', () => {
	const docs = ['README.md', 'companion/HELP.md'].map((file) => ({ file, text: read(file) }))

	it('points at the script where it is', () => {
		expect(existsSync(new URL(SCRIPT_PATH, root))).toBe(true)
		for (const { file, text } of docs) expect(text, file).toContain(SCRIPT_PATH)
	})

	it('does not write down version numbers, which would go out of date', () => {
		for (const { file, text } of docs) {
			expect(text.match(/\bv?\d+\.\d+\.\d+\b/g) ?? [], file).toEqual([])
		}
	})
})
