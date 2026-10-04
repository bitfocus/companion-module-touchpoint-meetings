import type ModuleInstance from './main.js'
import type { Phase, Room, RoomWatch } from './types.js'

type RoomOptions = {
	room: (string | number)[]
	includeChildren: boolean
	minutesBefore: number
	minutesAfter: number
}

export type FeedbacksSchema = {
	room_phase_active: {
		type: 'boolean'
		options: RoomOptions & { phase: Phase[] }
	}
	room_meeting_name: {
		type: 'value'
		options: RoomOptions
	}
}

const PHASES: Phase[] = ['setup', 'event', 'teardown']
const MAX_MINUTES = 1440

/** "Building > Floor > Room" for each room, so that rooms with common names can be told apart. */
export function roomChoices(rooms: Room[]): { id: number; label: string }[] {
	const byId = new Map(rooms.map((r) => [r.id, r]))

	const pathOf = (room: Room): string => {
		const names = [room.name]
		const seen = new Set<number>([room.id])
		let parent = room.parentId === null ? undefined : byId.get(room.parentId)
		while (parent && !seen.has(parent.id)) {
			names.unshift(parent.name)
			seen.add(parent.id)
			parent = parent.parentId === null ? undefined : byId.get(parent.parentId)
		}
		return names.join(' > ')
	}

	return rooms.map((r) => ({ id: r.id, label: pathOf(r) })).sort((a, b) => a.label.localeCompare(b.label))
}

/** Option values are lists, but tolerate a single value (such as from an expression, or an older version). */
function toList(value: unknown): unknown[] {
	if (Array.isArray(value)) return value
	if (value === undefined || value === null || value === '') return []
	return [value]
}

/** The selected rooms, or nothing if none are selected. */
function toWatch(options: RoomOptions): RoomWatch | undefined {
	const roomIds = toList(options.room)
		.map((r) => Number(r))
		.filter((r) => Number.isInteger(r))
	if (roomIds.length === 0) return undefined

	return {
		roomIds,
		includeChildren: !!options.includeChildren,
		minutesBefore: toMinutes(options.minutesBefore),
		minutesAfter: toMinutes(options.minutesAfter),
	}
}

function toMinutes(value: unknown): number {
	const minutes = Number(value)
	return Number.isFinite(minutes) ? Math.max(-MAX_MINUTES, Math.min(MAX_MINUTES, minutes)) : 0
}

function toPhases(value: unknown): Phase[] {
	return toList(value).filter((p): p is Phase => PHASES.includes(p as Phase))
}

export function UpdateFeedbacks(self: ModuleInstance, rooms: Room[]): void {
	const roomOptions = [
		{
			id: 'room',
			type: 'multidropdown',
			label: 'Rooms',
			tooltip: 'Rooms are loaded from TouchPoint. The feedback applies when any selected room matches.',
			choices: roomChoices(rooms),
			default: [] as number[],
			minChoicesForSearch: 0,
		},
		{
			id: 'includeChildren',
			type: 'checkbox',
			label: 'Include rooms inside these rooms',
			tooltip:
				'Also react to reservations of any rooms within the selected rooms, such as a building with several rooms.',
			default: false,
		},
		{
			id: 'minutesBefore',
			type: 'number',
			label: 'Minutes before',
			tooltip: 'Start this many minutes before the start time in TouchPoint.',
			default: 0,
			min: -MAX_MINUTES,
			max: MAX_MINUTES,
		},
		{
			id: 'minutesAfter',
			type: 'number',
			label: 'Minutes after',
			tooltip: 'Continue this many minutes after the end time in TouchPoint.',
			default: 0,
			min: -MAX_MINUTES,
			max: MAX_MINUTES,
		},
	] as const

	self.setFeedbackDefinitions({
		room_phase_active: {
			type: 'boolean',
			name: 'Room is in setup, in use, or in teardown',
			description:
				'True while any of the rooms has a reservation in any of the chosen phases. For a Trigger, "becomes true" is the start and "becomes false" is the end.',
			defaultStyle: {
				bgcolor: 0x00aa00,
				color: 0xffffff,
			},
			options: [
				...roomOptions,
				{
					id: 'phase',
					type: 'multidropdown',
					label: 'Phases',
					choices: [
						{ id: 'event', label: 'Event (in use)' },
						{ id: 'setup', label: 'Setup' },
						{ id: 'teardown', label: 'Teardown' },
					],
					default: ['event'],
					minSelection: 1,
					sortSelection: true,
				},
			],
			callback: (feedback) =>
				self.evaluatePhases(feedback.id, toWatch(feedback.options), toPhases(feedback.options.phase)),
			unsubscribe: (feedback) => self.forgetFeedback(feedback.id),
		},
		room_meeting_name: {
			type: 'value',
			name: 'Name of the meeting using the room',
			description:
				'The name of the meeting in setup, in use, or in teardown, or blank when there is none. For use in expressions.',
			options: [...roomOptions],
			callback: (feedback) => self.evaluateMeetingName(feedback.id, toWatch(feedback.options)),
			unsubscribe: (feedback) => self.forgetFeedback(feedback.id),
		},
	})
}
