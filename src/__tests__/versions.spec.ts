import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MODULE_VERSION, REPOSITORY_URL, SCRIPT_PATH, SCRIPT_SOURCE, SCRIPT_VERSION } from '../scriptSource.js'
import { parseVersion } from '../version.js'

// The module is made of several things that each carry a version or an address, and have to agree: the package and the
// manifest, the TouchPoint script and its copy inside the module, the tag that the settings link to, CI, and the docs.
// These tests are what keep them in step. When one fails, the message says what to change.

const root = new URL('../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n')
const json = (path: string) => JSON.parse(read(path)) as Record<string, any>

const packageJson = json('package.json')
const manifest = json('companion/manifest.json')
const script = read(SCRIPT_PATH)
const scriptVersion = /^VERSION = "([0-9.]+)"/m.exec(script)?.[1]

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
})

describe('the TouchPoint script’s version', () => {
	it('is a dotted number, because that is all the script itself accepts', () => {
		expect(scriptVersion).toBeDefined()
		expect(parseVersion(scriptVersion)).toBeDefined()
	})

	it('is the one in the copy embedded in the module (run `npm run embed`)', () => {
		expect(SCRIPT_VERSION).toBe(scriptVersion)
		expect(SCRIPT_SOURCE).toBe(script)
		expect(SCRIPT_SOURCE).toContain(`VERSION = "${SCRIPT_VERSION}"`)
	})

	it('is the one in the result the script’s tests and the client’s tests share', () => {
		expect(json('test/fixtures/windows-result.json').scriptVersion).toBe(scriptVersion)
	})

	describe('when the script changes', () => {
		// Installed copies only update to a higher version, so a change that keeps the version never reaches anyone.
		const lock = json('touchpoint/script-version.json')
		const sha256 = createHash('sha256').update(script).digest('hex')

		it('has been raised, with `npm run embed` run afterwards', () => {
			expect(
				lock,
				`touchpoint/CompanionMeetings.py changed without raising its VERSION (still ${scriptVersion}). ` +
					'Raise VERSION, then run `npm run embed`.',
			).toEqual({ version: scriptVersion, sha256 })
		})
	})

	it('runs the module’s package build, which embeds the script', () => {
		expect(packageJson.scripts.build).toContain('npm run embed')
		expect(packageJson.scripts.dev).toContain('npm run embed')
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
