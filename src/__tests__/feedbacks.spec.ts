import { describe, expect, it } from 'vitest'
import { roomChoices, UpdateFeedbacks } from '../feedbacks.js'
import type ModuleInstance from '../main.js'
import type { Room } from '../types.js'

const room = (id: number, parentId: number | null, name: string): Room => ({
	id,
	parentId,
	typeId: 1,
	name,
	reservable: true,
})

describe('roomChoices', () => {
	it('labels each room with where it is, sorted by that label', () => {
		const rooms = [
			room(3, 2, 'Room 101'),
			room(1, null, 'Main Building'),
			room(2, 1, 'Second Floor'),
			room(4, null, 'Annex'),
		]

		expect(roomChoices(rooms)).toEqual([
			{ id: 4, label: 'Annex' },
			{ id: 1, label: 'Main Building' },
			{ id: 2, label: 'Main Building > Second Floor' },
			{ id: 3, label: 'Main Building > Second Floor > Room 101' },
		])
	})

	it('tells apart rooms with the same name', () => {
		const labels = roomChoices([
			room(1, null, 'North'),
			room(2, 1, 'Hall'),
			room(3, null, 'South'),
			room(4, 3, 'Hall'),
		]).map((c) => c.label)

		expect(labels).toContain('North > Hall')
		expect(labels).toContain('South > Hall')
	})

	it('copes with a missing parent and with a loop', () => {
		expect(roomChoices([room(2, 99, 'Orphan')])).toEqual([{ id: 2, label: 'Orphan' }])
		expect(roomChoices([room(1, 2, 'A'), room(2, 1, 'B')])).toHaveLength(2)
	})

	it('has nothing to offer before any rooms are loaded', () => {
		expect(roomChoices([])).toEqual([])
	})
})

type Option = { id: string; type: string; default?: unknown; min?: number; max?: number; clampValues?: boolean }

/** The feedbacks the module defines, as Companion would be given them. */
function definedFeedbacks(): Record<string, { options: Option[] }> {
	let defined: Record<string, { options: Option[] }> = {}
	const self = { setFeedbackDefinitions: (definitions: typeof defined) => (defined = definitions) }
	UpdateFeedbacks(self as unknown as ModuleInstance, [])
	return defined
}

describe('the minutes options on the feedbacks', () => {
	const cases = ['room_phase_active', 'room_meeting_name'].flatMap((feedback) =>
		['minutesBefore', 'minutesAfter'].map((option) => [feedback, option] as const),
	)

	it.each(cases)(
		'%s › %s is limited to a day either way, and a value beyond that is pulled into range',
		(feedback, id) => {
			const option = definedFeedbacks()[feedback].options.find((o) => o.id === id)

			expect(option).toMatchObject({ type: 'number', default: 0, min: -1440, max: 1440 })
			// Without this, Companion rejects an expression that gives, say, 5000, and skips the feedback altogether, instead
			// of using the nearest allowed value (which the module itself would also do).
			expect(option?.clampValues).toBe(true)
		},
	)
})
