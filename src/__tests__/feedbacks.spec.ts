import { describe, expect, it } from 'vitest'
import { roomChoices } from '../feedbacks.js'
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
