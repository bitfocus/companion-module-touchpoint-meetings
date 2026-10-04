import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SCRIPT_SOURCE, SCRIPT_VERSION } from '../scriptSource.js'
import { parseVersion } from '../version.js'

const python = readFileSync(new URL('../../touchpoint/CompanionMeetings.py', import.meta.url), 'utf8').replace(
	/\r\n/g,
	'\n',
)

describe('the script embedded in the module', () => {
	it('is the current touchpoint/CompanionMeetings.py (run `npm run embed` if this fails)', () => {
		expect(SCRIPT_SOURCE).toBe(python)
	})

	it('reports the version the script declares', () => {
		expect(SCRIPT_VERSION).toBe(/^VERSION = "([0-9.]+)"/m.exec(python)?.[1])
		expect(parseVersion(SCRIPT_VERSION)).toBeDefined()
	})

	it('can be installed through the TouchPoint API, and can update itself again', () => {
		expect(SCRIPT_SOURCE.startsWith('#API')).toBe(true)
		expect(SCRIPT_SOURCE).toContain('updateScript')
	})
})
