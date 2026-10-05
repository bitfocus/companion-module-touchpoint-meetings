import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GetConfigFields } from '../config.js'
import { scriptIntroduction, scriptUrl, SCRIPT_URL } from '../links.js'
import { MODULE_VERSION, REPOSITORY_URL, SCRIPT_PATH } from '../scriptSource.js'

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
	const visible = text.replace(/<[^>]*>/g, ' ') // what a person reads, without the markup (and so without the link's address)

	it('links to the script that goes with this version of the module', () => {
		expect(text).toContain(`<a href="${SCRIPT_URL}" target="_blank">CompanionMeetings script</a>`)
	})

	it('does not write out the address, or any version number: the link goes to the right place', () => {
		expect(visible).not.toContain('http')
		expect(visible).not.toContain(MODULE_VERSION)
		expect(visible).not.toMatch(/\d+\.\d+\.\d+/)
	})

	it('says where to install it, and what the user needs', () => {
		expect(visible).toContain('Admin &gt; Advanced &gt; Special Content &gt; Python Scripts')
		expect(visible).toContain('Developer')
		expect(visible).toContain('APIOnly')
	})

	it('says that this is done once, and that the module takes it from there', () => {
		expect(visible).toContain('only do this once')
		expect(visible).toContain('keeps it up to date')
	})

	it('uses only the HTML that Companion shows: paragraphs, a numbered list, a link, and bold', () => {
		const tags = [...text.matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[1].toLowerCase())
		expect(new Set(tags)).toEqual(new Set(['p', 'ol', 'li', 'a', 'b']))
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
