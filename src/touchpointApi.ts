import { MODULE_VERSION, SCRIPT_SOURCE } from './scriptSource.js'
import type { Room, RoomWindow, ServerClock } from './types.js'
import { compareVersions, parseVersion } from './version.js'

export type TouchPointClientOptions = {
	host: string
	username: string
	password: string
	scriptName: string
	requestTimeoutMs: number
	/** Where TouchPoint is. Defaults to https://{host}; different only for testing. */
	baseUrl?: string
	/** This module's version, which is also the version of the script it needs, and the script it installs to get it. Different only for testing. */
	moduleVersion?: string
	scriptSource?: string
}

export class TouchPointError extends Error {
	constructor(
		message: string,
		readonly kind: 'auth' | 'connection' | 'outdated',
		readonly deployedVersion?: string,
	) {
		super(message)
	}
}

/**
 * Talks to the CompanionMeetings script through TouchPoint's Python API (`/PythonAPI/{script}`), which takes HTTP Basic
 * authentication and returns `{ output, data }`, with the script's result in `data.result`.
 */
export class TouchPointClient {
	private readonly url: string
	private readonly authorization: string
	private readonly requestTimeoutMs: number
	private readonly moduleVersion: string
	private readonly scriptSource: string

	constructor(options: TouchPointClientOptions) {
		const host = options.host
			.trim()
			.replace(/^https?:\/\//i, '')
			.replace(/\/+$/, '')
		this.url = `${options.baseUrl ?? `https://${host}`}/PythonAPI/${encodeURIComponent(options.scriptName.trim())}`
		this.authorization = 'Basic ' + Buffer.from(`${options.username}:${options.password}`).toString('base64')
		this.requestTimeoutMs = Math.max(1000, options.requestTimeoutMs)
		this.moduleVersion = options.moduleVersion ?? MODULE_VERSION
		this.scriptSource = options.scriptSource ?? SCRIPT_SOURCE
	}

	async getRooms(): Promise<{ rooms: Room[] }> {
		const result = await this.call({ a: 'rooms' })
		const rooms: Room[] = []
		for (const r of asArray(result.rooms)) {
			const id = Number(r.id)
			if (!Number.isInteger(id)) continue
			rooms.push({
				id,
				parentId: r.parentId === null || r.parentId === undefined ? null : Number(r.parentId),
				typeId: Number(r.typeId),
				name: text(r.name, String(id)),
				reservable: !!r.reservable,
			})
		}
		return { rooms }
	}

	async getWindows(
		roomIds: number[],
		backMinutes: number,
		aheadMinutes: number,
	): Promise<{ windows: RoomWindow[]; clock: ServerClock; offsetMs: number }> {
		const result = await this.call({
			a: 'windows',
			rooms: roomIds.join(','),
			back: String(Math.round(backMinutes)),
			ahead: String(Math.round(aheadMinutes)),
		})
		const clock = parseClock(result.now)
		// Reservation times are in the church's local time; the script reports how far that is from UTC, from
		// TouchPoint's LocalTimeZone setting. (The database and server clock can be in a different zone.)
		const offsetMinutes = Number(result.utcOffsetMinutes)
		if (result.utcOffsetMinutes === undefined || !Number.isFinite(offsetMinutes)) {
			throw new TouchPointError(
				'The script did not report a time zone offset. Update the CompanionMeetings script.',
				'connection',
			)
		}
		const offsetMs = offsetMinutes * 60_000

		const windows: RoomWindow[] = []
		for (const w of asArray(result.windows)) {
			const startMs = parseNaive(w.start) - offsetMs
			const endMs = parseNaive(w.end) - offsetMs
			if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue
			windows.push({
				reservationId: Number(w.reservationId),
				roomId: Number(w.reservableId),
				meetingId: Number(w.meetingId),
				name: text(w.name, ''),
				setupStartMs: startMs - Math.max(0, Number(w.setupMinutes) || 0) * 60_000,
				startMs,
				endMs,
				teardownEndMs: endMs + Math.max(0, Number(w.teardownMinutes) || 0) * 60_000,
			})
		}
		return { windows, clock, offsetMs }
	}

	/** Replaces the script in TouchPoint with this module's copy of it. The installed script checks that it's newer. */
	async updateScript(): Promise<{ updatedFrom: string; updatedTo: string }> {
		const result = await this.call({ a: 'updateScript', content: this.scriptSource }, false)
		return { updatedFrom: text(result.updatedFrom, '?'), updatedTo: text(result.updatedTo, '?') }
	}

	private async call(params: Record<string, string>, checkVersion = true): Promise<Record<string, unknown>> {
		const abort = new AbortController()
		const timeout = setTimeout(() => abort.abort(), this.requestTimeoutMs)

		let response: Response
		try {
			response = await fetch(this.url, {
				method: 'POST',
				signal: abort.signal,
				headers: {
					Authorization: this.authorization,
					Accept: 'application/json',
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: new URLSearchParams(params).toString(),
				redirect: 'manual', // a bad login redirects to an HTML sign-in page.
			})
		} catch (e) {
			throw new TouchPointError(
				abort.signal.aborted ? 'Request timed out' : `Could not reach TouchPoint: ${errorText(e)}`,
				'connection',
			)
		} finally {
			clearTimeout(timeout)
		}

		if (response.status === 401 || response.status === 403 || (response.status >= 300 && response.status < 400)) {
			throw new TouchPointError(
				'TouchPoint rejected the credentials. The user needs the Developer and APIOnly roles.',
				'auth',
			)
		}
		if (response.status === 404) {
			throw new TouchPointError('Script not found. Check the script name, and that it begins with #API.', 'connection')
		}
		if (!response.ok) {
			throw new TouchPointError(`TouchPoint returned HTTP ${response.status}`, 'connection')
		}

		let envelope: { output?: unknown; data?: { result?: unknown } }
		try {
			envelope = (await response.json()) as { output?: unknown; data?: { result?: unknown } }
		} catch (e) {
			throw new TouchPointError(`Unexpected response from TouchPoint: ${errorText(e)}`, 'connection')
		}

		const result = envelope.data?.result
		if (!result || typeof result !== 'object') {
			// The script didn't get as far as reporting a result, so whatever it printed is the best explanation.
			const printed = text(envelope.output, '')
				.replace(/<[^>]*>/g, ' ')
				.replace(/\s+/g, ' ')
				.trim()
			throw new TouchPointError(
				`The script returned no result${printed ? `: ${printed.slice(0, 300)}` : ''}`,
				'connection',
			)
		}

		const parsed = result as Record<string, unknown>
		if (checkVersion) this.checkScriptVersion(parsed)
		if (parsed.ok !== true) {
			throw new TouchPointError(`The script reported an error: ${text(parsed.error, 'unknown')}`, 'connection')
		}
		return parsed
	}

	/**
	 * The version of the script in TouchPoint, when it is newer than this module. That is left alone, but worth saying:
	 * the script and module are released together, so a newer script means that this module is out of date.
	 */
	newerScriptVersion: string | undefined

	/**
	 * The module and the script are one thing with one version, so the script must be the module's version or newer.
	 * It is out of date if it is older, or too old to report a version at all.
	 */
	private checkScriptVersion(result: Record<string, unknown>): void {
		const deployed = text(result.scriptVersion, '')
		const deployedVersion = parseVersion(deployed)
		const expected = parseVersion(this.moduleVersion)
		const comparison = deployedVersion && expected ? compareVersions(deployedVersion, expected) : -1

		if (comparison < 0) {
			throw new TouchPointError(
				`The TouchPoint script is out of date (it is ${deployed ? `version ${deployed}` : 'too old to report a version'}; this module is version ${this.moduleVersion}, and needs the script to match).`,
				'outdated',
				deployed,
			)
		}
		this.newerScriptVersion = comparison > 0 ? deployed : undefined
	}
}

function asArray(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object') : []
}

/** A string or number as a string; anything else as the fallback. */
function text(value: unknown, fallback: string): string {
	return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback
}

function errorText(e: unknown): string {
	return e instanceof Error ? e.message : String(e)
}

/** Reads "2026-10-04T09:30:00" as if it were UTC */
function parseNaive(value: unknown): number {
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(String(value))
	if (!m) return Number.NaN
	return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
}

function parseClock(now: unknown): ServerClock {
	const naiveNowMs = parseNaive(now)
	if (!Number.isFinite(naiveNowMs))
		throw new TouchPointError('TouchPoint did not report the current time', 'connection')
	return { naiveNowMs }
}
