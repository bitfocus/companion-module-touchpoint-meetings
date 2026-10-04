import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModuleConfig } from '../config.js'
import ModuleInstance from '../main.js'
import { SCRIPT_SOURCE, SCRIPT_VERSION } from '../scriptSource.js'
import type { RoomWatch } from '../types.js'

// Companion's base class does nothing useful outside Companion, so it is replaced with one that records what the
// module asks of it.
vi.mock('@companion-module/base', () => {
	class InstanceBase {
		updateStatus = vi.fn()
		log = vi.fn()
		setVariableValues = vi.fn()
		setVariableDefinitions = vi.fn()
		setFeedbackDefinitions = vi.fn()
		setActionDefinitions = vi.fn()
		setPresetDefinitions = vi.fn()
		checkFeedbacks = vi.fn()
		checkFeedbacksById = vi.fn()
	}
	return {
		InstanceBase,
		InstanceStatus: {
			Ok: 'ok',
			Connecting: 'connecting',
			BadConfig: 'bad_config',
			AuthenticationFailure: 'authentication_failure',
			ConnectionFailure: 'connection_failure',
		},
		Regex: { HOSTNAME: '.*' },
	}
})

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 4, 21, 30) // 17:30 in the church's time zone, which is UTC-4 in the tests
const UTC_OFFSET_MINUTES = -240

const naive = (ms: number) => new Date(ms + UTC_OFFSET_MINUTES * MIN).toISOString().slice(0, 19)

type FakeRoom = { id: number; parentId: number | null; name: string }
type FakeReservation = ReturnType<typeof reservation>

/** A reservation, in the way the script reports it. Times are minutes from now. */
function reservation(roomId: number, startsIn: number, endsIn: number, setup = 0, teardown = 0, name = 'Choir') {
	return {
		reservationId: roomId * 100 + startsIn,
		reservableId: roomId,
		meetingId: roomId,
		name,
		start: naive(NOW + startsIn * MIN),
		end: naive(NOW + endsIn * MIN),
		setupMinutes: setup,
		teardownMinutes: teardown,
	}
}

/** TouchPoint, standing in for the real thing at the other end of fetch. */
const touchpoint = {
	deployedVersion: undefined as string | undefined,
	canUpdateItself: true, // whether the installed script has the updateScript action
	status: 200,
	unreachable: false,
	rooms: [] as FakeRoom[],
	reservations: [] as FakeReservation[],
	requests: [] as { a: string; url: string; params: URLSearchParams }[],

	reset() {
		this.deployedVersion = SCRIPT_VERSION
		this.canUpdateItself = true
		this.status = 200
		this.unreachable = false
		this.rooms = [
			{ id: 3, parentId: null, name: 'Sanctuary' },
			{ id: 4, parentId: 3, name: 'Balcony' },
		]
		this.reservations = []
		this.requests = []
	},

	count(action: string) {
		return this.requests.filter((r) => r.a === action).length
	},

	respond(url: string, body: string): Response {
		const params = new URLSearchParams(body)
		const a = params.get('a') ?? ''
		this.requests.push({ a, url, params })

		if (this.unreachable) throw new TypeError('fetch failed')
		if (this.status !== 200) return new Response('', { status: this.status })

		const reply = (result: unknown) => new Response(JSON.stringify({ output: '', data: { result } }))
		const version = this.deployedVersion ? { scriptVersion: this.deployedVersion } : {}

		if (a === 'updateScript') {
			if (!this.canUpdateItself) return reply({ ok: false, error: 'unknown action' })
			const updatedFrom = this.deployedVersion
			this.deployedVersion = SCRIPT_VERSION
			return reply({ ok: true, scriptVersion: SCRIPT_VERSION, updatedFrom, updatedTo: SCRIPT_VERSION })
		}
		if (a === 'rooms') {
			return reply({ ok: true, ...version, rooms: this.rooms.map((r) => ({ ...r, typeId: 1, reservable: true })) })
		}
		if (a === 'windows') {
			const wanted = (params.get('rooms') ?? '').split(',').map(Number)
			return reply({
				ok: true,
				...version,
				now: naive(Date.now()),
				utcOffsetMinutes: UTC_OFFSET_MINUTES,
				windows: this.reservations.filter((r) => wanted.includes(r.reservableId)),
			})
		}
		return reply({ ok: false, ...version, error: 'unknown action' })
	},
}

const config = (changes: Partial<ModuleConfig> = {}): ModuleConfig => ({
	host: 'church.example.org',
	username: 'api-user',
	scriptName: 'CompanionMeetings',
	pollIntervalSeconds: 30,
	requestTimeoutMs: 5000,
	autoUpdateScript: true,
	...changes,
})

const watch = (roomIds: number[], changes: Partial<RoomWatch> = {}): RoomWatch => ({
	roomIds,
	includeChildren: false,
	minutesBefore: 0,
	minutesAfter: 0,
	...changes,
})

let instances: ModuleInstance[]

async function start(changes: Partial<ModuleConfig> = {}, secrets: { password?: string } = { password: 'pw' }) {
	const instance = new ModuleInstance({})
	instances.push(instance)
	await instance.init(config(changes), true, secrets)
	await advance(0)
	return instance
}

/** Let time pass, including the promises that fetch and the module's timers set off. */
const advance = async (ms: number): Promise<void> => {
	await vi.advanceTimersByTimeAsync(ms)
}

const statuses = (instance: ModuleInstance) => vi.mocked(instance.updateStatus).mock.calls
const lastStatus = (instance: ModuleInstance) => statuses(instance).at(-1)
const logged = (instance: ModuleInstance, level: string) =>
	vi
		.mocked(instance.log)
		.mock.calls.filter((c) => c[0] === level)
		.map((c) => c[1])

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
	vi.setSystemTime(NOW)
	instances = []
	touchpoint.reset()
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: { body: string }) => touchpoint.respond(url, init.body)),
	)
})

afterEach(async () => {
	for (const instance of instances) await instance.destroy()
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

describe('connecting', () => {
	it('loads the room list and reports OK', async () => {
		const instance = await start()

		expect(touchpoint.requests.map((r) => r.a)).toEqual(['rooms'])
		expect(lastStatus(instance)).toEqual(['ok'])
		expect(vi.mocked(instance.setVariableValues).mock.calls.at(-1)?.[0]).toMatchObject({ rooms_loaded: '2' })
		// Feedbacks are redefined, so that the room dropdown has the rooms in it.
		expect(vi.mocked(instance.setFeedbackDefinitions).mock.calls.length).toBeGreaterThanOrEqual(2)
	})

	it('does not ask for reservations until a feedback is watching a room', async () => {
		await start()
		await advance(5 * MIN)
		expect(touchpoint.count('windows')).toBe(0)
	})

	it.each([
		['host', { host: '' }, 'host'],
		['username', { username: '' }, 'username'],
		['script name', { scriptName: '' }, 'Script name'],
	])('needs the %s', async (_label, changes, mentioned) => {
		const instance = await start(changes)

		expect(lastStatus(instance)?.[0]).toBe('bad_config')
		expect(lastStatus(instance)?.[1]).toContain(mentioned)
		expect(touchpoint.requests).toEqual([])
	})

	it('needs the password', async () => {
		const instance = await start({}, {})
		expect(lastStatus(instance)).toEqual(['bad_config', 'API password is required'])
		expect(touchpoint.requests).toEqual([])
	})

	it('reports bad credentials, and does not try to update anything', async () => {
		touchpoint.status = 401
		const instance = await start()

		expect(lastStatus(instance)?.[0]).toBe('authentication_failure')
		expect(touchpoint.count('updateScript')).toBe(0)
	})

	it('reports TouchPoint being unreachable, and recovers by itself', async () => {
		touchpoint.unreachable = true
		const instance = await start()
		expect(lastStatus(instance)?.[0]).toBe('connection_failure')

		touchpoint.unreachable = false
		await advance(30_000)
		expect(lastStatus(instance)).toEqual(['ok'])
	})

	it('stops polling when it is destroyed', async () => {
		const instance = await start()
		await instance.destroy()
		const before = touchpoint.requests.length

		await advance(30 * MIN)
		expect(touchpoint.requests).toHaveLength(before)
	})

	it('reconnects to a new host when the settings change', async () => {
		const instance = await start()
		await instance.configUpdated(config({ host: 'other.example.org' }), { password: 'pw' })
		await advance(0)

		expect(touchpoint.requests.at(-1)?.url).toBe('https://other.example.org/PythonAPI/CompanionMeetings')
	})
})

describe('a feedback watching a room', () => {
	it('is true while the meeting is on, and the feedback is re-checked when that changes', async () => {
		touchpoint.reservations = [reservation(3, -10, 50)]
		const instance = await start()

		expect(instance.evaluatePhases('fb', watch([3]), ['event'])).toBe(false) // nothing is known yet
		await advance(600)

		expect(touchpoint.requests.at(-1)?.params.get('rooms')).toBe('3')
		expect(vi.mocked(instance.checkFeedbacksById)).toHaveBeenCalledWith('fb')
		expect(instance.evaluatePhases('fb', watch([3]), ['event'])).toBe(true)
	})

	it('turns off at the second the meeting ends, not at the next refresh', async () => {
		touchpoint.reservations = [reservation(3, -10, 50)]
		const instance = await start()
		instance.evaluatePhases('fb', watch([3]), ['event'])
		await advance(600)
		vi.mocked(instance.checkFeedbacksById).mockClear()

		await advance(49 * MIN + 55_000) // 5 seconds before the end
		expect(vi.mocked(instance.checkFeedbacksById)).not.toHaveBeenCalled()
		expect(instance.evaluatePhases('fb', watch([3]), ['event'])).toBe(true)

		await advance(10_000)
		expect(vi.mocked(instance.checkFeedbacksById)).toHaveBeenCalledWith('fb')
		expect(instance.evaluatePhases('fb', watch([3]), ['event'])).toBe(false)
	})

	it('turns on at the second a meeting starts', async () => {
		touchpoint.reservations = [reservation(3, 20, 80)]
		const instance = await start()
		instance.evaluatePhases('fb', watch([3]), ['event'])
		await advance(600)
		expect(instance.evaluatePhases('fb', watch([3]), ['event'])).toBe(false)
		vi.mocked(instance.checkFeedbacksById).mockClear()

		await advance(20 * MIN)
		expect(vi.mocked(instance.checkFeedbacksById)).toHaveBeenCalledWith('fb')
		expect(instance.evaluatePhases('fb', watch([3]), ['event'])).toBe(true)
	})

	it('follows setup and teardown separately', async () => {
		touchpoint.reservations = [reservation(3, 10, 70, 15, 10)]
		const instance = await start()
		instance.evaluatePhases('s', watch([3]), ['setup'])
		await advance(600)

		const states = () => ({
			setup: instance.evaluatePhases('s', watch([3]), ['setup']),
			event: instance.evaluatePhases('e', watch([3]), ['event']),
			teardown: instance.evaluatePhases('t', watch([3]), ['teardown']),
		})
		expect(states()).toEqual({ setup: true, event: false, teardown: false }) // setup began 5 minutes ago
		await advance(10 * MIN)
		expect(states()).toEqual({ setup: false, event: true, teardown: false })
		await advance(60 * MIN)
		expect(states()).toEqual({ setup: false, event: false, teardown: true })
		await advance(10 * MIN)
		expect(states()).toEqual({ setup: false, event: false, teardown: false })
	})

	it('can start early and finish late', async () => {
		touchpoint.reservations = [reservation(3, 20, 80)]
		const instance = await start()
		const padded = watch([3], { minutesBefore: 30, minutesAfter: 15 })
		instance.evaluatePhases('fb', padded, ['event'])
		await advance(600)

		expect(instance.evaluatePhases('fb', padded, ['event'])).toBe(true) // 20 minutes to go, and 30 are allowed
		await advance(90 * MIN) // 10 minutes past the end
		expect(instance.evaluatePhases('fb', padded, ['event'])).toBe(true)
		await advance(10 * MIN)
		expect(instance.evaluatePhases('fb', padded, ['event'])).toBe(false)
	})

	it('asks for reservations far enough either side to cover the padding', async () => {
		const instance = await start()

		instance.evaluatePhases('a', watch([3]), ['event'])
		await advance(600)
		expect(touchpoint.requests.at(-1)?.params.get('back')).toBe('60')
		expect(touchpoint.requests.at(-1)?.params.get('ahead')).toBe('1440')

		instance.evaluatePhases('b', watch([3], { minutesBefore: 30, minutesAfter: 120 }), ['event'])
		await advance(600)
		expect(touchpoint.requests.at(-1)?.params.get('back')).toBe('180')
		expect(touchpoint.requests.at(-1)?.params.get('ahead')).toBe('1470')
	})

	it('can include the rooms inside it', async () => {
		touchpoint.reservations = [reservation(4, -10, 50)]
		const instance = await start()

		instance.evaluatePhases('without', watch([3]), ['event'])
		instance.evaluatePhases('with', watch([3], { includeChildren: true }), ['event'])
		await advance(600)

		expect(touchpoint.requests.at(-1)?.params.get('rooms')).toBe('3,4')
		expect(instance.evaluatePhases('without', watch([3]), ['event'])).toBe(false)
		expect(instance.evaluatePhases('with', watch([3], { includeChildren: true }), ['event'])).toBe(true)
	})

	it('shares one request between feedbacks added together', async () => {
		const instance = await start()

		instance.evaluatePhases('a', watch([3]), ['event'])
		instance.evaluatePhases('b', watch([9]), ['setup'])
		await advance(600)

		expect(touchpoint.count('windows')).toBe(1)
		expect(touchpoint.requests.at(-1)?.params.get('rooms')).toBe('3,9')
	})

	it('stops being asked about when the feedback is removed', async () => {
		const instance = await start()
		instance.evaluatePhases('fb', watch([3]), ['event'])
		await advance(600)
		expect(touchpoint.count('windows')).toBe(1)

		instance.forgetFeedback('fb')
		await advance(5 * MIN)
		expect(touchpoint.count('windows')).toBe(1)
	})

	it('has no state with no room chosen', async () => {
		const instance = await start()
		expect(instance.evaluatePhases('fb', undefined, ['event'])).toBe(false)
		expect(instance.evaluateMeetingName('fb2', undefined)).toBe('')
		await advance(5 * MIN)
		expect(touchpoint.count('windows')).toBe(0)
	})

	it('refreshes on the interval, and refreshes the room list less often', async () => {
		const instance = await start()
		instance.evaluatePhases('fb', watch([3]), ['event'])
		await advance(95_000)
		expect(touchpoint.count('windows')).toBe(4) // when added, then at 30, 60 and 90 seconds
		expect(touchpoint.count('rooms')).toBe(1)

		await advance(10 * MIN)
		expect(touchpoint.count('rooms')).toBe(2)
	})

	it('keeps applying what it already knew while TouchPoint is unreachable', async () => {
		touchpoint.reservations = [reservation(3, -10, 50)]
		const instance = await start()
		instance.evaluatePhases('fb', watch([3]), ['event'])
		await advance(600)

		touchpoint.unreachable = true
		await advance(60_000)

		expect(lastStatus(instance)?.[0]).toBe('connection_failure')
		expect(instance.evaluatePhases('fb', watch([3]), ['event'])).toBe(true)
		await advance(50 * MIN)
		expect(instance.evaluatePhases('fb', watch([3]), ['event'])).toBe(false) // and it still ends on time
	})
})

describe('the meeting name', () => {
	it('is the meeting using the room, in any phase, and blank otherwise', async () => {
		touchpoint.reservations = [reservation(3, 10, 70, 15, 10, 'Choir ½')]
		const instance = await start()
		instance.evaluateMeetingName('n', watch([3]))
		await advance(600)

		expect(instance.evaluateMeetingName('n', watch([3]))).toBe('Choir ½') // in setup
		await advance(80 * MIN)
		expect(instance.evaluateMeetingName('n', watch([3]))).toBe('') // after teardown
	})

	it('is the earliest meeting when two overlap', async () => {
		touchpoint.reservations = [reservation(3, -10, 50, 0, 0, 'Second'), { ...reservation(3, -30, 50, 0, 0, 'First') }]
		const instance = await start()
		instance.evaluateMeetingName('n', watch([3]))
		await advance(600)

		expect(instance.evaluateMeetingName('n', watch([3]))).toBe('First')
	})
})

describe('keeping the script in TouchPoint up to date', () => {
	it('installs this module’s copy over an older one, then carries on', async () => {
		touchpoint.deployedVersion = '0.5.0'
		const instance = await start()

		expect(touchpoint.requests.map((r) => r.a)).toEqual(['rooms', 'updateScript', 'rooms'])
		expect(touchpoint.requests[1].params.get('content')).toBe(SCRIPT_SOURCE)
		expect(lastStatus(instance)).toEqual(['ok'])
		expect(logged(instance, 'info')).toEqual([`Updated the TouchPoint script from version 0.5.0 to ${SCRIPT_VERSION}`])
		expect(vi.mocked(instance.setVariableValues).mock.calls.at(-1)?.[0]).toMatchObject({ rooms_loaded: '2' })
	})

	it('installs it over a script too old to report a version', async () => {
		touchpoint.deployedVersion = undefined
		const instance = await start()

		expect(touchpoint.count('updateScript')).toBe(1)
		expect(lastStatus(instance)).toEqual(['ok'])
	})

	it('leaves a newer script alone', async () => {
		touchpoint.deployedVersion = '999.0.0'
		const instance = await start()

		expect(touchpoint.count('updateScript')).toBe(0)
		expect(lastStatus(instance)).toEqual(['ok'])
	})

	it('does not touch an up-to-date script', async () => {
		await start()
		expect(touchpoint.count('updateScript')).toBe(0)
	})

	it('asks first, in effect, when automatic updates are turned off', async () => {
		touchpoint.deployedVersion = '0.5.0'
		const instance = await start({ autoUpdateScript: false })

		expect(touchpoint.count('updateScript')).toBe(0)
		expect(lastStatus(instance)?.[0]).toBe('bad_config')
		expect(lastStatus(instance)?.[1]).toContain('automatic script updates')
	})

	it('updates when the setting is missing, as it is for connections made before it existed', async () => {
		touchpoint.deployedVersion = '0.5.0'
		const old = config()
		delete (old as Partial<ModuleConfig>).autoUpdateScript
		const instance = new ModuleInstance({})
		instances.push(instance)
		await instance.init(old, true, { password: 'pw' })
		await advance(0)

		expect(touchpoint.count('updateScript')).toBe(1)
	})

	it('explains how to install it by hand when the installed script cannot update itself, and tries only once', async () => {
		touchpoint.deployedVersion = undefined
		touchpoint.canUpdateItself = false
		const instance = await start()

		expect(lastStatus(instance)?.[0]).toBe('bad_config')
		expect(lastStatus(instance)?.[1]).toContain('could not be updated automatically')
		expect(lastStatus(instance)?.[1]).toContain('manually')

		await advance(5 * MIN)
		expect(touchpoint.count('updateScript')).toBe(1) // not on every refresh
		expect(lastStatus(instance)?.[0]).toBe('bad_config')
	})

	it('recovers by itself once the script has been installed by hand', async () => {
		touchpoint.deployedVersion = undefined
		touchpoint.canUpdateItself = false
		const instance = await start()
		expect(lastStatus(instance)?.[0]).toBe('bad_config')

		touchpoint.deployedVersion = SCRIPT_VERSION
		await advance(30_000)
		expect(lastStatus(instance)).toEqual(['ok'])
	})

	it('tries again after the settings change', async () => {
		touchpoint.deployedVersion = undefined
		touchpoint.canUpdateItself = false
		const instance = await start()
		expect(touchpoint.count('updateScript')).toBe(1)

		await instance.configUpdated(config(), { password: 'pw' })
		await advance(0)
		expect(touchpoint.count('updateScript')).toBe(2)
	})

	it('does not update because of an unreachable TouchPoint', async () => {
		touchpoint.unreachable = true
		await start()
		expect(touchpoint.count('updateScript')).toBe(0)
	})
})
