import { describe, expect, it } from 'vitest'
import { compareVersions, parseVersion } from '../version.js'

describe('parseVersion', () => {
	it('reads dotted numbers', () => {
		expect(parseVersion('1.0.0')).toEqual([1, 0, 0])
		expect(parseVersion('2')).toEqual([2])
		expect(parseVersion('10.20')).toEqual([10, 20])
	})

	it('rejects anything else', () => {
		for (const bad of ['', '1.', '.1', '1..2', 'v1.0', '1.0-beta', 'one', undefined, null, 1.5]) {
			expect(parseVersion(bad)).toBeUndefined()
		}
	})
})

describe('compareVersions', () => {
	it('compares numerically, not as text', () => {
		expect(compareVersions([1, 0, 10], [1, 0, 9])).toBeGreaterThan(0)
		expect(compareVersions([1, 9], [1, 10])).toBeLessThan(0)
	})

	it('treats missing parts as zero', () => {
		expect(compareVersions([1, 0], [1, 0, 0])).toBe(0)
		expect(compareVersions([1], [1, 0, 1])).toBeLessThan(0)
	})
})
