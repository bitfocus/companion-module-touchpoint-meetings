import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MODULE_VERSION, SCRIPT_SOURCE } from '../scriptSource.js'
import { parseVersion } from '../version.js'

const python = readFileSync(new URL('../../touchpoint/CompanionMeetings.py', import.meta.url), 'utf8').replace(
	/\r\n/g,
	'\n',
)

describe('the script embedded in the module', () => {
	it('is the current touchpoint/CompanionMeetings.py (run `npm run embed` if this fails)', () => {
		expect(SCRIPT_SOURCE).toBe(python)
	})

	it('declares the module’s version as its own, because they are one thing with one version', () => {
		expect(/^VERSION = "([^"]+)"/m.exec(python)?.[1]).toBe(MODULE_VERSION)
		expect(parseVersion(MODULE_VERSION)).toBeDefined()
	})

	it('can be installed through the TouchPoint API, and can update itself again', () => {
		expect(SCRIPT_SOURCE.startsWith('#API')).toBe(true)
		expect(SCRIPT_SOURCE).toContain('updateScript')
	})
})
