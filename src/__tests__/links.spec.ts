import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GetConfigFields } from '../config.js'
import { scriptIntroduction, scriptUrl, SCRIPT_URL } from '../links.js'
import { MODULE_VERSION, REPOSITORY_URL, SCRIPT_PATH, SCRIPT_VERSION } from '../scriptSource.js'

describe('scriptUrl', () => {
	it("points at the script as it is at the module release's tag", () => {
		expect(scriptUrl('https://github.com/example/repo', '1.2.3', 'dir/Script.py')).toBe(
			'https://github.com/example/repo/blob/v1.2.3/dir/Script.py',
		)
	})

	it('is for this version of this module', () => {
		expect(SCRIPT_URL).toBe(`${REPOSITORY_URL}/blob/v${MODULE_VERSION}/${SCRIPT_PATH}`)
	})
})

describe('the introduction to the script in the connection settings', () => {
	const text = scriptIntroduction()

	it('links to the script that goes with this version of the module', () => {
		expect(text).toContain(`<a href="${SCRIPT_URL}" target="_blank">`)
	})

	it('also writes the address out, for places where a link is not clickable', () => {
		expect(text).toContain(`(${SCRIPT_URL})`)
	})

	it('says which version of the script that is', () => {
		expect(text).toContain(`script version ${SCRIPT_VERSION}`)
	})

	it('says where to install it, and what the user needs', () => {
		expect(text).toContain('Admin &gt; Advanced &gt; Special Content &gt; Python Scripts')
		expect(text).toContain('Developer')
		expect(text).toContain('APIOnly')
	})

	it('uses only the HTML that Companion shows (links, bold, and line breaks)', () => {
		const tags = [...text.matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[1].toLowerCase())
		expect(new Set(tags)).toEqual(new Set(['a', 'b', 'br']))
	})

	it('is shown at the top of the settings, as the connection’s info', () => {
		const field = GetConfigFields()[0]
		expect(field).toMatchObject({ type: 'static-text', id: 'info', value: text })
	})
})

describe('the connection settings', () => {
	it('default to the name the script is published under', () => {
		const scriptName = GetConfigFields().find((f) => f.id === 'scriptName')
		expect(scriptName).toMatchObject({ default: basename(SCRIPT_PATH, '.py') })
	})
})
