import type { CompanionMigrationFeedback } from '@companion-module/base'
import { describe, expect, it } from 'vitest'
import { UpgradeScripts } from '../upgrades.js'

type Options = CompanionMigrationFeedback['options']

function feedback(feedbackId: string, options: Options, id = 'f'): CompanionMigrationFeedback {
	return { id, controlId: 'c', feedbackId, options }
}

const value = (v: unknown) => ({ isExpression: false as const, value: v as never })

/** Runs all the upgrade scripts in order, as Companion would for a feedback saved by the very first version. */
function upgradeAll(feedbacks: CompanionMigrationFeedback[]): CompanionMigrationFeedback[] {
	let current = feedbacks
	for (const script of UpgradeScripts) {
		const result = script({} as never, { config: null, secrets: null, actions: [], feedbacks: current })
		const changed = new Map(result.updatedFeedbacks.map((f) => [f.id, f]))
		current = current.map((f) => changed.get(f.id) ?? f)
	}
	return current
}

describe('upgrade scripts', () => {
	it("bring the first version's feedback options up to date", () => {
		const [upgraded] = upgradeAll([
			feedback('room_phase_active', { room: value('12'), phase: value('setup'), includeChildren: value(true) }),
		])

		expect(upgraded.options).toEqual({
			room: value(['12']),
			phase: value(['setup']),
			includeChildren: value(true),
			minutesBefore: value(0),
			minutesAfter: value(0),
		})
	})

	it('treat a blank room as no rooms', () => {
		const [upgraded] = upgradeAll([feedback('room_phase_active', { room: value(''), phase: value('event') })])
		expect(upgraded.options.room).toEqual(value([]))
	})

	it('leave expressions alone', () => {
		const expression = { isExpression: true as const, value: '$(local:room)' }
		const [upgraded] = upgradeAll([feedback('room_meeting_name', { room: expression })])
		expect(upgraded.options.room).toEqual(expression)
	})

	it('replace the removed "any" phase with the three phases it meant, keeping any others', () => {
		const [onlyAny, anyAndEvent] = upgradeAll([
			feedback('room_phase_active', { room: value(['1']), phase: value(['any']) }, 'a'),
			feedback('room_phase_active', { room: value(['1']), phase: value(['event', 'any']) }, 'b'),
		])

		expect(onlyAny.options.phase).toEqual(value(['setup', 'event', 'teardown']))
		expect([...(anyAndEvent.options.phase!.value as string[])].sort()).toEqual(['event', 'setup', 'teardown'])
	})

	it('keep what people already chose', () => {
		const [upgraded] = upgradeAll([
			feedback('room_phase_active', {
				room: value(['1']),
				phase: value(['event']),
				minutesBefore: value(10),
				minutesAfter: value(5),
			}),
		])

		expect(upgraded.options.minutesBefore).toEqual(value(10))
		expect(upgraded.options.minutesAfter).toEqual(value(5))
		expect(upgraded.options.phase).toEqual(value(['event']))
	})

	it('ignore other feedbacks', () => {
		const other = feedback('something_else', { room: value('x') })
		expect(upgradeAll([other])[0]).toEqual(other)
	})

	it('can be run twice without changing the result', () => {
		const once = upgradeAll([feedback('room_phase_active', { room: value('12'), phase: value('any') })])
		expect(upgradeAll(structuredClone(once))).toEqual(once)
	})
})
