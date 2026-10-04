import { describe, expect, it } from 'vitest'
import { activeWindows, expandRoomIds } from '../occupancy.js'
import type { Phase, Room, RoomWatch, RoomWindow } from '../types.js'

const MIN = 60_000
const T = Date.UTC(2026, 9, 4, 10, 0) // 10:00 UTC

function room(id: number, parentId: number | null): Room {
	return { id, parentId, typeId: 1, name: `Room ${id}`, reservable: true }
}

/** By default: setup begins 15 minutes before 10:00, the event runs one hour, and teardown takes ten minutes. */
function reservation(roomId = 3, setup = 15, teardown = 10): RoomWindow {
	return {
		reservationId: 1,
		roomId,
		meetingId: 1,
		name: 'Meeting',
		setupStartMs: T - setup * MIN,
		startMs: T,
		endMs: T + 60 * MIN,
		teardownEndMs: T + (60 + teardown) * MIN,
	}
}

/** The minutes (relative to 10:00) at which the state turns on and off. */
function edges(windows: RoomWindow[], roomIds: number[], phases: Phase[], before = 0, after = 0): string {
	const ids = new Set(roomIds)
	const found: string[] = []
	let previous = false
	for (let m = -120; m <= 180; m++) {
		const active =
			activeWindows(windows, ids, phases, T + m * MIN, { beforeMs: before * MIN, afterMs: after * MIN }).length > 0
		if (active !== previous) found.push(`${active ? 'on' : 'off'}@${m}`)
		previous = active
	}
	return found.join(' ') || 'never'
}

describe('expandRoomIds', () => {
	const rooms = [room(1, null), room(2, 1), room(3, 2), room(9, null), room(10, 9)]
	const watch = (roomIds: number[], includeChildren: boolean): RoomWatch => ({
		roomIds,
		includeChildren,
		minutesBefore: 0,
		minutesAfter: 0,
	})
	const sorted = (ids: Set<number>) => [...ids].sort((a, b) => a - b)

	it('is just the rooms chosen, unless children are included', () => {
		expect(sorted(expandRoomIds(watch([2, 9], false), rooms))).toEqual([2, 9])
	})

	it('includes every level beneath each room chosen', () => {
		expect(sorted(expandRoomIds(watch([1], true), rooms))).toEqual([1, 2, 3])
		expect(sorted(expandRoomIds(watch([2, 9], true), rooms))).toEqual([2, 3, 9, 10])
	})

	it('does not loop on a room that is its own ancestor', () => {
		expect(sorted(expandRoomIds(watch([1], true), [room(1, 2), room(2, 1)]))).toEqual([1, 2])
	})

	it('keeps rooms TouchPoint does not know about', () => {
		expect(sorted(expandRoomIds(watch([77], true), rooms))).toEqual([77])
	})
})

describe('activeWindows', () => {
	const windows = [reservation()]

	it('follows each phase, to the minute', () => {
		expect(edges(windows, [3], ['setup'])).toBe('on@-15 off@0')
		expect(edges(windows, [3], ['event'])).toBe('on@0 off@60')
		expect(edges(windows, [3], ['teardown'])).toBe('on@60 off@70')
	})

	it('only counts the rooms asked about', () => {
		expect(edges(windows, [4], ['event'])).toBe('never')
		expect(edges(windows, [4, 3], ['event'])).toBe('on@0 off@60')
	})

	it('is one continuous state when every phase is selected', () => {
		expect(edges(windows, [3], ['setup', 'event', 'teardown'])).toBe('on@-15 off@70')
	})

	it('is true for any selected phase, with a gap between phases that are not adjacent', () => {
		expect(edges(windows, [3], ['setup', 'teardown'])).toBe('on@-15 off@0 on@60 off@70')
	})

	describe('minutes before', () => {
		it('starts the state early and leaves the end alone', () => {
			expect(edges(windows, [3], ['event'], 10)).toBe('on@-10 off@60')
		})

		it('starts it late when negative', () => {
			expect(edges(windows, [3], ['event'], -10)).toBe('on@10 off@60')
		})
	})

	describe('minutes after', () => {
		it('extends the end and leaves the start alone', () => {
			expect(edges(windows, [3], ['event'], 0, 15)).toBe('on@0 off@75')
		})

		it('ends it early when negative', () => {
			expect(edges(windows, [3], ['event'], 0, -15)).toBe('on@0 off@45')
		})
	})

	it('moves only the outer edges of a period made of several phases', () => {
		expect(edges(windows, [3], ['setup', 'event', 'teardown'], 10, 15)).toBe('on@-25 off@85')
	})

	it('does not open a gap between adjacent phases when shrinking', () => {
		expect(edges(windows, [3], ['setup', 'event'], -10, -10)).toBe('on@-5 off@50')
	})

	it('pads each of two separate periods at its own outer edges', () => {
		expect(edges(windows, [3], ['setup', 'teardown'], 5, 5)).toBe('on@-20 off@5 on@55 off@75')
	})

	it('is never true when shrinking more than the period is long', () => {
		expect(edges(windows, [3], ['event'], -40, -40)).toBe('never')
	})

	it('ignores a phase that has no length, even with padding', () => {
		expect(edges([reservation(3, 0, 10)], [3], ['setup'], 10)).toBe('never')
		expect(edges([reservation(3, 15, 0)], [3], ['teardown'], 0, 10)).toBe('never')
	})

	it('joins back-to-back meetings into one state when padding bridges the gap', () => {
		const second: RoomWindow = {
			...reservation(),
			reservationId: 2,
			setupStartMs: T + 65 * MIN,
			startMs: T + 65 * MIN,
			endMs: T + 100 * MIN,
			teardownEndMs: T + 100 * MIN,
		}
		expect(edges([...windows, second], [3], ['event'])).toBe('on@0 off@60 on@65 off@100')
		expect(edges([...windows, second], [3], ['event'], 0, 5)).toBe('on@0 off@105')
	})

	it('has no state with no phases selected', () => {
		expect(edges(windows, [3], [])).toBe('never')
	})
})
