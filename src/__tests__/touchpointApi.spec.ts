import { readFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TouchPointClient, TouchPointError } from '../touchpointApi.js'

// What the CompanionMeetings script returns, as a fixture shared with the script's own tests.
const fixture = JSON.parse(
	readFileSync(new URL('../../test/fixtures/windows-result.json', import.meta.url), 'utf8'),
) as Record<string, unknown>

type Seen = {
	method?: string
	url?: string
	authorization?: string
	contentType?: string
	params: URLSearchParams
}

type Reply = { status?: number; headers?: Record<string, string>; body?: string; delayMs?: number }

/** The fixture, as reported by a script at the version these tests' client expects. */
const fromScript = (changes: Record<string, unknown> = {}) => ({ ...fixture, scriptVersion: '1.2.0', ...changes })

/** What TouchPoint's Python API sends back around a script's result. */
const envelope = (result: unknown, output = ''): Reply => ({ body: JSON.stringify({ output, data: { result } }) })

let server: http.Server
let seen: Seen[]
let reply: (request: Seen) => Reply
let baseUrl: string

beforeEach(async () => {
	seen = []
	reply = () => envelope({ ok: true, scriptVersion: '1.2.0' })

	server = http.createServer((req, res) => {
		let body = ''
		req.on('data', (chunk: Buffer) => (body += chunk.toString()))
		req.on('end', () => {
			const request: Seen = {
				method: req.method,
				url: req.url,
				authorization: req.headers.authorization,
				contentType: req.headers['content-type'],
				params: new URLSearchParams(body),
			}
			seen.push(request)

			const r = reply(request)
			setTimeout(() => {
				res.writeHead(r.status ?? 200, { 'content-type': 'application/json', ...r.headers })
				res.end(r.body ?? '')
			}, r.delayMs ?? 0)
		})
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
	server.closeAllConnections()
	await new Promise((resolve) => server.close(resolve))
})

function client(overrides: Partial<ConstructorParameters<typeof TouchPointClient>[0]> = {}): TouchPointClient {
	return new TouchPointClient({
		host: 'church.example.org',
		username: 'api-user',
		password: 'secret',
		scriptName: 'CompanionMeetings',
		requestTimeoutMs: 3000,
		baseUrl,
		moduleVersion: '1.2.0',
		scriptSource: '#API\nVERSION = "1.2.0"\n# updateScript\n',
		...overrides,
	})
}

async function failureOf(promise: Promise<unknown>): Promise<TouchPointError> {
	try {
		await promise
	} catch (e) {
		expect(e).toBeInstanceOf(TouchPointError)
		return e as TouchPointError
	}
	throw new Error('expected a failure')
}

describe('requests', () => {
	it('POST the parameters as a form to the script, with Basic authentication', async () => {
		await client().getRooms()

		expect(seen).toHaveLength(1)
		expect(seen[0].method).toBe('POST')
		expect(seen[0].url).toBe('/PythonAPI/CompanionMeetings')
		expect(seen[0].contentType).toBe('application/x-www-form-urlencoded')
		expect(seen[0].params.get('a')).toBe('rooms')
		expect(seen[0].authorization).toBe('Basic ' + Buffer.from('api-user:secret').toString('base64'))
	})

	it('send passwords that contain colons and non-ASCII characters intact', async () => {
		await client({ password: 'p:ässwörd' }).getRooms()

		const decoded = Buffer.from(seen[0].authorization!.replace('Basic ', ''), 'base64').toString('utf8')
		expect(decoded).toBe('api-user:p:ässwörd')
	})

	it('encode an unusual script name', async () => {
		await client({ scriptName: 'My Script' }).getRooms()
		expect(seen[0].url).toBe('/PythonAPI/My%20Script')
	})

	describe('to a host', () => {
		afterEach(() => vi.unstubAllGlobals())

		it('use https, and tolerate a pasted scheme or trailing slash', async () => {
			const fetchStub = vi.fn(async () => new Response(envelope({ ok: true, scriptVersion: '1.2.0' }).body))
			vi.stubGlobal('fetch', fetchStub)

			await client({ baseUrl: undefined, host: ' https://Church.tpsdb.com/ ' }).getRooms()

			expect(fetchStub.mock.calls[0]).toEqual([
				'https://Church.tpsdb.com/PythonAPI/CompanionMeetings',
				expect.anything(),
			])
		})
	})
})

describe('getRooms', () => {
	it('reads the rooms and their parents', async () => {
		reply = () =>
			envelope({
				ok: true,
				scriptVersion: '1.2.0',
				rooms: [
					{ id: 1, parentId: null, typeId: 1, name: 'Building', reservable: false },
					{ id: 2, parentId: 1, typeId: 1, name: 'Room ½', reservable: true },
					{ id: 'bad', name: 'Dropped: no numeric id' },
				],
			})

		expect((await client().getRooms()).rooms).toEqual([
			{ id: 1, parentId: null, typeId: 1, name: 'Building', reservable: false },
			{ id: 2, parentId: 1, typeId: 1, name: 'Room ½', reservable: true },
		])
	})

	it('has no rooms when the script lists none', async () => {
		expect((await client().getRooms()).rooms).toEqual([])
	})
})

describe('getWindows', () => {
	beforeEach(() => {
		reply = () => envelope(fromScript())
	})

	it('ask for the rooms, and how far either side of now', async () => {
		await client().getWindows([3, 4], 180.4, 1470)

		expect(seen[0].params.get('a')).toBe('windows')
		expect(seen[0].params.get('rooms')).toBe('3,4')
		expect(seen[0].params.get('back')).toBe('180')
		expect(seen[0].params.get('ahead')).toBe('1470')
	})

	it("turn the church's local times into real instants, using the offset the script reports", async () => {
		const { windows, offsetMs, clock } = await client().getWindows([3, 4], 60, 1440)

		// The fixture is UTC-4 (Eastern daylight time): 17:00 local is 21:00 UTC.
		expect(offsetMs).toBe(-4 * 3_600_000)
		expect(clock.naiveNowMs).toBe(Date.UTC(2026, 9, 4, 17, 30))
		expect(windows[0]).toEqual({
			reservationId: 11,
			roomId: 3,
			meetingId: 7,
			name: 'Choir ½ Rehearsal',
			setupStartMs: Date.UTC(2026, 9, 4, 20, 45), // 15 minutes of setup
			startMs: Date.UTC(2026, 9, 4, 21, 0),
			endMs: Date.UTC(2026, 9, 4, 22, 0),
			teardownEndMs: Date.UTC(2026, 9, 4, 22, 5), // 5 minutes of teardown
		})
		expect(windows[1]).toMatchObject({
			roomId: 4,
			setupStartMs: Date.UTC(2026, 9, 4, 23, 0), // no setup or teardown time
			startMs: Date.UTC(2026, 9, 4, 23, 0),
			endMs: Date.UTC(2026, 9, 5, 0, 30),
			teardownEndMs: Date.UTC(2026, 9, 5, 0, 30),
		})
	})

	it('follow a different time zone', async () => {
		reply = () => envelope(fromScript({ utcOffsetMinutes: 330 })) // India
		const { windows } = await client().getWindows([3], 60, 1440)

		expect(windows[0].startMs).toBe(Date.UTC(2026, 9, 4, 11, 30)) // 17:00 local
	})

	it('ignore reservations with times it cannot read', async () => {
		reply = () =>
			envelope(
				fromScript({
					windows: [{ reservationId: 1, reservableId: 3, meetingId: 1, name: 'x', start: 'soon', end: 'later' }],
				}),
			)
		expect((await client().getWindows([3], 60, 1440)).windows).toEqual([])
	})

	it('refuse to guess the time zone if the script does not report it', async () => {
		reply = () => envelope(fromScript({ utcOffsetMinutes: undefined }))

		const error = await failureOf(client().getWindows([3], 60, 1440))
		expect(error.message).toContain('time zone offset')
	})
})

describe('failures', () => {
	it.each([401, 403])('are reported as a credentials problem for HTTP %i', async (status) => {
		reply = () => ({ status, body: '' })

		const error = await failureOf(client().getRooms())
		expect(error.kind).toBe('auth')
		expect(error.message).toContain('Developer and APIOnly')
	})

	it('treat a redirect, which is what a bad login gets, as a credentials problem', async () => {
		reply = () => ({ status: 302, headers: { location: '/Account/LogOn' }, body: '' })
		expect((await failureOf(client().getRooms())).kind).toBe('auth')
	})

	it('say when the script is not there', async () => {
		reply = () => ({ status: 404, body: '' })

		const error = await failureOf(client().getRooms())
		expect(error.kind).toBe('connection')
		expect(error.message).toContain('Script not found')
	})

	it('report other HTTP errors', async () => {
		reply = () => ({ status: 500, body: '' })
		expect((await failureOf(client().getRooms())).message).toContain('HTTP 500')
	})

	it('report a response that is not JSON', async () => {
		reply = () => ({ body: '<html>Sign in</html>' })
		expect((await failureOf(client().getRooms())).message).toContain('Unexpected response')
	})

	it('explain a script that never produced a result, using what it printed', async () => {
		reply = () => envelope(undefined, '<pre>Traceback (most recent call last):\n  File "x", line 1</pre>')

		const error = await failureOf(client().getRooms())
		expect(error.message).toContain('no result')
		expect(error.message).toContain('Traceback (most recent call last): File "x", line 1')
		expect(error.message).not.toContain('<pre>')
	})

	it('report an error the script caught', async () => {
		reply = () => envelope({ ok: false, scriptVersion: '1.2.0', error: 'ValueError: boom' })

		const error = await failureOf(client().getRooms())
		expect(error.kind).toBe('connection')
		expect(error.message).toContain('ValueError: boom')
	})

	it('give up when TouchPoint takes too long', async () => {
		reply = () => ({ ...envelope({ ok: true, scriptVersion: '1.2.0' }), delayMs: 3000 })

		const error = await failureOf(client({ requestTimeoutMs: 1000 }).getRooms())
		expect(error.message).toContain('timed out')
	}, 10_000)

	it('report TouchPoint being unreachable', async () => {
		await new Promise((resolve) => server.close(resolve))
		const error = await failureOf(client().getRooms())
		expect(error.kind).toBe('connection')
		expect(error.message).toContain('Could not reach TouchPoint')
	})
})

describe('the version of the script in TouchPoint', () => {
	// The module and the script are one thing with one version. Here the module is version 1.2.0.
	const deployed = (scriptVersion?: string) => {
		reply = () => envelope({ ok: true, scriptVersion, rooms: [] })
	}

	it('is fine when it is the module’s version', async () => {
		deployed('1.2.0')
		const c = client()
		await expect(c.getRooms()).resolves.toBeDefined()
		expect(c.newerScriptVersion).toBeUndefined()
	})

	it.each(['1.2.1', '1.3.0', '1.10.0', '2.0.0', '1.3.0-beta.1'])(
		'is left alone, and noted, when it is newer: %s',
		async (version) => {
			deployed(version)
			const c = client()
			await expect(c.getRooms()).resolves.toBeDefined()
			expect(c.newerScriptVersion).toBe(version)
		},
	)

	it.each(['1.1.9', '1.1.99', '1.0.0', '0.9.0', '1.2.0-rc.1', '1.2.0-0'])(
		'is out of date when it is older: %s',
		async (version) => {
			deployed(version)

			const error = await failureOf(client().getRooms())
			expect(error.kind).toBe('outdated')
			expect(error.deployedVersion).toBe(version)
			expect(error.message).toContain(`version ${version}`)
			expect(error.message).toContain('this module is version 1.2.0')
		},
	)

	it('follows semantic versioning for a module that is itself a pre-release', async () => {
		deployed('1.3.0-beta.1')
		await expect(client({ moduleVersion: '1.3.0-beta.1' }).getRooms()).resolves.toBeDefined()

		deployed('1.3.0-beta.1')
		expect((await failureOf(client({ moduleVersion: '1.3.0-beta.2' }).getRooms())).kind).toBe('outdated')

		deployed('1.3.0')
		await expect(client({ moduleVersion: '1.3.0-beta.2' }).getRooms()).resolves.toBeDefined() // the release is newer
	})

	it('is out of date when it is too old to report a version at all', async () => {
		deployed(undefined)

		const error = await failureOf(client().getRooms())
		expect(error.kind).toBe('outdated')
		expect(error.message).toContain('too old to report a version')
	})

	it.each(['latest', '1.2', '1', 'v1.2.0'])('is out of date when the version is not a version: %s', async (version) => {
		deployed(version)
		expect((await failureOf(client().getRooms())).kind).toBe('outdated')
	})

	it('is checked on every kind of request', async () => {
		deployed('1.0.0')
		expect((await failureOf(client().getWindows([3], 60, 1440))).kind).toBe('outdated')
	})
})

describe('updateScript', () => {
	it("sends this module's copy of the script, and says what it replaced", async () => {
		reply = () => envelope({ ok: true, scriptVersion: '1.0.0', updatedFrom: '1.0.0', updatedTo: '1.2.0' })

		const result = await client().updateScript()

		expect(result).toEqual({ updatedFrom: '1.0.0', updatedTo: '1.2.0' })
		expect(seen[0].params.get('a')).toBe('updateScript')
		expect(seen[0].params.get('content')).toBe('#API\nVERSION = "1.2.0"\n# updateScript\n')
	})

	it('works even when the installed script is too old to report a version', async () => {
		reply = () => envelope({ ok: true, updatedFrom: '?', updatedTo: '1.2.0' })
		await expect(client().updateScript()).resolves.toEqual({ updatedFrom: '?', updatedTo: '1.2.0' })
	})

	it('reports a refusal, such as a script too old to know how to update itself', async () => {
		reply = () => envelope({ ok: false, error: 'unknown action' })

		const error = await failureOf(client().updateScript())
		expect(error.message).toContain('unknown action')
	})

	it('reports bad credentials', async () => {
		reply = () => ({ status: 401, body: '' })
		expect((await failureOf(client().updateScript())).kind).toBe('auth')
	})
})
