export type Phase = 'setup' | 'event' | 'teardown'

/** A room (or other reservable) as reported by TouchPoint */
export type Room = {
	id: number
	parentId: number | null
	typeId: number
	name: string
	reservable: boolean
}

/**
 * A reservation of one room for one meeting.  Timestamps are true epoch milliseconds (already corrected from
 * TouchPoint's local time).
 */
export type RoomWindow = {
	reservationId: number
	roomId: number
	meetingId: number
	name: string
	setupStartMs: number
	startMs: number
	endMs: number
	teardownEndMs: number
}

/** Something a feedback wants to know about: some rooms, and optionally everything inside them */
export type RoomWatch = {
	roomIds: number[]
	includeChildren: boolean
	/** Minutes before the real start that the state begins. Negative values begin it later. */
	minutesBefore: number
	/** Minutes after the real end that the state continues. Negative values end it sooner. */
	minutesAfter: number
}

/** The things TouchPoint tells us on each call */
export type ServerClock = {
	/** TouchPoint's local clock, expressed as if it were UTC. */
	naiveNowMs: number
}
