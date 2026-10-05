import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compareVersions, parseVersion } from '../version.js'

// These cases are shared with the tests of the TouchPoint script, which compares versions for itself. The script and
// the module have to agree about which of two versions is newer, so both are held to the same list.
const cases = JSON.parse(
	readFileSync(new URL('../../test/fixtures/version-comparisons.json', import.meta.url), 'utf8'),
) as {
	valid: string[]
	invalid: string[]
	comparisons: [string, string, -1 | 0 | 1][]
}

describe('parseVersion', () => {
	it.each(cases.valid)('reads %s', (text) => {
		expect(parseVersion(text)).toBeDefined()
	})

	it.each(cases.invalid)('rejects %j', (text) => {
		expect(parseVersion(text)).toBeUndefined()
	})

	it('rejects what is not text', () => {
		for (const bad of [undefined, null, 1, 1.5, {}, ['1.2.3']]) expect(parseVersion(bad)).toBeUndefined()
	})

	it('reads the parts', () => {
		expect(parseVersion('10.20.30')).toEqual({ core: [10, 20, 30], prerelease: undefined })
		expect(parseVersion('1.2.3-beta.1+build')).toEqual({ core: [1, 2, 3], prerelease: ['beta', '1'] })
	})
})

describe('compareVersions', () => {
	it.each(cases.comparisons)('%s against %s is %i', (a, b, expected) => {
		expect(Math.sign(compareVersions(parseVersion(a)!, parseVersion(b)!))).toBe(expected)
	})

	it('puts the semantic versioning specification’s own example in order', () => {
		const inOrder = [
			'1.0.0-alpha',
			'1.0.0-alpha.1',
			'1.0.0-alpha.beta',
			'1.0.0-beta',
			'1.0.0-beta.2',
			'1.0.0-beta.11',
			'1.0.0-rc.1',
			'1.0.0',
		]
		const shuffled = [...inOrder].reverse()
		expect(shuffled.sort((a, b) => compareVersions(parseVersion(a)!, parseVersion(b)!))).toEqual(inOrder)
	})
})
