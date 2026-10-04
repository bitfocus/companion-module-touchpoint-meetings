import type { Phase, Room, RoomWatch, RoomWindow } from './types.js'

/** The ids of the watched rooms and, optionally, every room beneath them. */
export function expandRoomIds(watch: RoomWatch, rooms: Room[]): Set<number> {
	const ids = new Set<number>(watch.roomIds)
	if (!watch.includeChildren) return ids

	const childrenOf = new Map<number, number[]>()
	for (const r of rooms) {
		if (r.parentId === null) continue
		const siblings = childrenOf.get(r.parentId) ?? []
		siblings.push(r.id)
		childrenOf.set(r.parentId, siblings)
	}

	const queue = [...watch.roomIds]
	while (queue.length > 0) {
		for (const child of childrenOf.get(queue.pop()!) ?? []) {
			if (!ids.has(child)) {
				ids.add(child)
				queue.push(child)
			}
		}
	}
	return ids
}

export type Padding = { beforeMs: number; afterMs: number }

type Interval = { fromMs: number; toMs: number }

function phaseInterval(w: RoomWindow, phase: Phase): Interval {
	switch (phase) {
		case 'setup':
			return { fromMs: w.setupStartMs, toMs: w.startMs }
		case 'event':
			return { fromMs: w.startMs, toMs: w.endMs }
		case 'teardown':
			return { fromMs: w.endMs, toMs: w.teardownEndMs }
	}
}

/**
 * The periods covered by the selected phases of a reservation.  Phases that run into each other, such as setup and
 * event, are one period, so that padding only moves the outer edges of it.  A phase with no length (for example, no
 * setup time) isn't a period at all.
 */
function selectedPeriods(w: RoomWindow, phases: Phase[]): Interval[] {
	const intervals = phases
		.map((phase) => phaseInterval(w, phase))
		.filter((i) => i.toMs > i.fromMs)
		.sort((a, b) => a.fromMs - b.fromMs)

	const periods: Interval[] = []
	for (const interval of intervals) {
		const last = periods[periods.length - 1]
		if (last && interval.fromMs <= last.toMs) {
			last.toMs = Math.max(last.toMs, interval.toMs)
		} else {
			periods.push({ ...interval })
		}
	}
	return periods
}

/**
 * The windows, among the given rooms, that are in any of the phases right now.  The start of each period is moved
 * earlier by `beforeMs`, and its end later by `afterMs`.
 */
export function activeWindows(
	windows: RoomWindow[],
	roomIds: Set<number>,
	phases: Phase[],
	nowMs: number,
	pad: Padding,
): RoomWindow[] {
	return windows.filter(
		(w) =>
			roomIds.has(w.roomId) &&
			selectedPeriods(w, phases).some((p) => nowMs >= p.fromMs - pad.beforeMs && nowMs < p.toMs + pad.afterMs),
	)
}
