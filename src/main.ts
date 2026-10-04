import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { GetConfigFields, type ModuleConfig, type ModuleSecrets } from './config.js'
import { UpdateVariableDefinitions, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { TouchPointClient, TouchPointError } from './touchpointApi.js'
import { activeWindows, expandRoomIds } from './occupancy.js'
import type { Phase, Room, RoomWatch, RoomWindow } from './types.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: ModuleSecrets
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

const ROOMS_REFRESH_MS = 10 * 60_000
const DEFAULT_BACK_MINUTES = 60
const DEFAULT_AHEAD_MINUTES = 1440

function watchKey(watch: RoomWatch): string {
	return `${[...watch.roomIds].sort((a, b) => a - b).join(',')}|${watch.includeChildren}|${watch.minutesBefore}|${watch.minutesAfter}`
}

/** A feedback currently in use on a button or trigger, and the last answer given for it. */
type Subscription = {
	watch: RoomWatch
	phases: Phase[] | 'meeting'
	last: string | boolean
}

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig // Setup in init()
	secrets!: ModuleSecrets

	private rooms: Room[] = []
	private windows: RoomWindow[] = []
	private roomsLoadedMs = 0
	private lastRefreshIso = ''
	private readonly subscriptions = new Map<string, Subscription>()
	private scriptUpdateProblem: string | undefined // set when an automatic update failed, so it isn't retried every refresh.

	private pollTimer: NodeJS.Timeout | undefined
	private tickTimer: NodeJS.Timeout | undefined
	private debounceTimer: NodeJS.Timeout | undefined
	private generation = 0 // incremented whenever the connection is restarted, so that stale requests are ignored.

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig, _isFirstInit: boolean, secrets: ModuleSecrets): Promise<void> {
		this.config = config
		this.secrets = secrets

		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
		this.updateVariableDefinitions()
		this.pushVariableValues()
		this.restart()
	}

	async destroy(): Promise<void> {
		this.stop()
		this.log('debug', 'destroy')
	}

	async configUpdated(config: ModuleConfig, secrets: ModuleSecrets): Promise<void> {
		this.config = config
		this.secrets = secrets
		this.restart()
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	updateActions(): void {
		UpdateActions(this)
	}

	updateFeedbacks(): void {
		UpdateFeedbacks(this, this.rooms)
	}

	updatePresets(): void {
		UpdatePresets(this)
	}

	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
	}

	/** Reload the room list and reservations right now. */
	async refreshNow(): Promise<void> {
		this.roomsLoadedMs = 0
		await this.refresh(this.generation)
	}

	/**
	 * Called by feedbacks each time they are evaluated.  Remembers what the feedback is interested in, so that those
	 * rooms' reservations are fetched, and returns the current answer: whether any of the phases is active.
	 */
	evaluatePhases(feedbackId: string, watch: RoomWatch | undefined, phases: Phase[]): boolean {
		return this.track(feedbackId, watch, phases) === true
	}

	/** The name of the meeting using the room(s) in any phase right now, or an empty string. */
	evaluateMeetingName(feedbackId: string, watch: RoomWatch | undefined): string {
		const value = this.track(feedbackId, watch, 'meeting')
		return typeof value === 'string' ? value : ''
	}

	forgetFeedback(feedbackId: string): void {
		if (this.subscriptions.delete(feedbackId)) {
			this.scheduleWindowsRefresh()
		}
	}

	private track(feedbackId: string, watch: RoomWatch | undefined, phases: Phase[] | 'meeting'): string | boolean {
		if (!watch) {
			this.forgetFeedback(feedbackId)
			return phases === 'meeting' ? '' : false
		}

		const existing = this.subscriptions.get(feedbackId)
		const value = this.compute(watch, phases)
		this.subscriptions.set(feedbackId, { watch, phases, last: value })

		if (!existing || watchKey(existing.watch) !== watchKey(watch)) {
			this.scheduleWindowsRefresh()
		}
		return value
	}

	private compute(watch: RoomWatch, phases: Phase[] | 'meeting'): string | boolean {
		const ids = expandRoomIds(watch, this.rooms)
		const now = Date.now()
		const pad = { beforeMs: watch.minutesBefore * 60_000, afterMs: watch.minutesAfter * 60_000 }

		if (phases !== 'meeting') {
			return activeWindows(this.windows, ids, phases, now, pad).length > 0
		}

		const active = activeWindows(this.windows, ids, ['setup', 'event', 'teardown'], now, pad)
		active.sort((a, b) => a.startMs - b.startMs)
		return active[0]?.name ?? ''
	}

	private restart(): void {
		this.stop()
		const generation = this.generation

		const problem = this.validateConfig()
		if (problem) {
			this.updateStatus(InstanceStatus.BadConfig, problem)
			return
		}

		this.updateStatus(InstanceStatus.Connecting)
		this.roomsLoadedMs = 0
		this.scriptUpdateProblem = undefined
		this.tickTimer = setInterval(() => this.tick(), 1000)
		void this.pollLoop(generation)
	}

	private stop(): void {
		this.generation++
		clearTimeout(this.pollTimer)
		clearTimeout(this.debounceTimer)
		clearInterval(this.tickTimer)
		this.pollTimer = undefined
		this.debounceTimer = undefined
		this.tickTimer = undefined
	}

	private validateConfig(): string | undefined {
		if (!this.config.host?.trim()) return 'TouchPoint host is required'
		if (!this.config.scriptName?.trim()) return 'Script name is required'
		if (!this.config.username?.trim()) return 'API username is required'
		if (!this.secrets.password) return 'API password is required'
		return undefined
	}

	private buildClient(): TouchPointClient {
		return new TouchPointClient({
			host: this.config.host,
			username: this.config.username,
			password: this.secrets.password ?? '',
			scriptName: this.config.scriptName,
			requestTimeoutMs: this.config.requestTimeoutMs,
		})
	}

	private async pollLoop(generation: number): Promise<void> {
		await this.refresh(generation)
		if (generation !== this.generation) return

		const intervalMs = Math.max(10, this.config.pollIntervalSeconds || 30) * 1000
		this.pollTimer = setTimeout(() => void this.pollLoop(generation), intervalMs)
	}

	private scheduleWindowsRefresh(): void {
		if (this.debounceTimer || !this.tickTimer) return // not started, or one is already pending.
		const generation = this.generation
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = undefined
			void this.refresh(generation, true)
		}, 500)
	}

	private async refresh(generation: number, windowsOnly = false): Promise<void> {
		const client = this.buildClient()
		try {
			try {
				await this.loadFrom(client, generation, windowsOnly)
			} catch (error) {
				if (!(error instanceof TouchPointError) || error.kind !== 'outdated') throw error
				if (generation !== this.generation) return
				await this.updateScriptThenRetry(client, error, generation, windowsOnly)
			}
		} catch (error) {
			if (generation !== this.generation) return
			// Keep the last known reservations: times keep being applied while TouchPoint is unreachable.
			const message = error instanceof Error ? error.message : String(error)
			const kind = error instanceof TouchPointError ? error.kind : 'connection'
			this.updateStatus(
				kind === 'auth'
					? InstanceStatus.AuthenticationFailure
					: kind === 'outdated'
						? InstanceStatus.BadConfig
						: InstanceStatus.ConnectionFailure,
				message,
			)
			this.log('error', message)
		}
	}

	/** The script in TouchPoint is older than this module needs: install this module's copy, then try again, once. */
	private async updateScriptThenRetry(
		client: TouchPointClient,
		outdated: TouchPointError,
		generation: number,
		windowsOnly: boolean,
	): Promise<void> {
		if (this.config.autoUpdateScript === false) {
			throw new TouchPointError(
				`${outdated.message} Update it, or turn on automatic script updates in this connection's settings.`,
				'outdated',
			)
		}

		if (this.scriptUpdateProblem) throw new TouchPointError(this.scriptUpdateProblem, 'outdated')

		this.updateStatus(InstanceStatus.Connecting, 'Updating the TouchPoint script')
		try {
			const { updatedFrom, updatedTo } = await client.updateScript()
			this.log('info', `Updated the TouchPoint script from version ${updatedFrom} to ${updatedTo}`)
		} catch (error) {
			if (error instanceof TouchPointError && error.kind === 'auth') throw error
			this.scriptUpdateProblem =
				`${outdated.message} It could not be updated automatically (${error instanceof Error ? error.message : String(error)}). ` +
				'Install the current script manually; see the module help.'
			throw new TouchPointError(this.scriptUpdateProblem, 'outdated')
		}

		if (generation !== this.generation) return
		await this.loadFrom(client, generation, windowsOnly)
	}

	private async loadFrom(client: TouchPointClient, generation: number, windowsOnly: boolean): Promise<void> {
		if (!windowsOnly && Date.now() - this.roomsLoadedMs > ROOMS_REFRESH_MS) {
			const { rooms } = await client.getRooms()
			if (generation !== this.generation) return
			this.rooms = rooms
			this.roomsLoadedMs = Date.now()
			this.updateFeedbacks()
		}

		// Reservations are fetched far enough either side of now to cover every feedback's "minutes before" and "minutes after".
		const ids = new Set<number>()
		let backMinutes = DEFAULT_BACK_MINUTES
		let aheadMinutes = DEFAULT_AHEAD_MINUTES
		for (const sub of this.subscriptions.values()) {
			for (const id of expandRoomIds(sub.watch, this.rooms)) ids.add(id)
			backMinutes = Math.max(backMinutes, DEFAULT_BACK_MINUTES + sub.watch.minutesAfter)
			aheadMinutes = Math.max(aheadMinutes, DEFAULT_AHEAD_MINUTES + sub.watch.minutesBefore)
		}

		const result = ids.size > 0 ? await client.getWindows([...ids], backMinutes, aheadMinutes) : undefined
		if (generation !== this.generation) return
		if (result) this.logWindows(result.windows, result.clock.naiveNowMs, result.offsetMs, ids)
		this.windows = result?.windows ?? []

		this.lastRefreshIso = new Date().toISOString()
		this.updateStatus(InstanceStatus.Ok)
		this.pushVariableValues()
		this.tick()
	}

	/** For diagnosing time problems: what TouchPoint's clock said, how it was interpreted, and each reservation found. */
	private logWindows(windows: RoomWindow[], naiveNowMs: number, offsetMs: number, roomIds: Set<number>): void {
		const iso = (ms: number): string => new Date(ms).toISOString()
		this.log(
			'debug',
			`TouchPoint local time ${iso(naiveNowMs).slice(0, 19)}, this machine (UTC) ${iso(Date.now()).slice(0, 19)}, ` +
				`LocalTimeZone is UTC${offsetMs >= 0 ? '+' : '-'}${Math.abs(offsetMs) / 3_600_000}h; ` +
				`${windows.length} reservation(s) for rooms ${[...roomIds].join(',')}`,
		)
		for (const w of windows) {
			this.log(
				'debug',
				`room ${w.roomId} meeting ${w.meetingId}: setup ${iso(w.setupStartMs)}, start ${iso(w.startMs)}, ` +
					`end ${iso(w.endMs)}, teardown end ${iso(w.teardownEndMs)} (UTC)`,
			)
		}
	}

	/** Once a second, notice which feedbacks have changed answer because a start or end time has passed. */
	private tick(): void {
		const changed: string[] = []
		for (const [id, sub] of this.subscriptions) {
			const value = this.compute(sub.watch, sub.phases)
			if (value !== sub.last) {
				sub.last = value
				changed.push(id)
			}
		}
		if (changed.length > 0) this.checkFeedbacksById(...changed)
	}

	private pushVariableValues(): void {
		const watched = new Set<number>()
		for (const sub of this.subscriptions.values()) sub.watch.roomIds.forEach((id) => watched.add(id))

		this.setVariableValues({
			rooms_loaded: String(this.rooms.length),
			monitored_rooms: String(watched.size),
			upcoming_reservations: String(this.windows.length),
			last_refresh_time: this.lastRefreshIso,
		})
	}
}
