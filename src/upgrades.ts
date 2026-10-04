import type { CompanionMigrationFeedback, CompanionStaticUpgradeScript } from '@companion-module/base'
import type { ModuleConfig, ModuleSecrets } from './config.js'

/** Rooms and phases became lists (multi-select), and "Minutes before" was added. */
const roomsAndPhasesBecomeLists: CompanionStaticUpgradeScript<ModuleConfig, ModuleSecrets> = (_context, props) => {
	const updatedFeedbacks: CompanionMigrationFeedback[] = []

	for (const feedback of props.feedbacks) {
		if (feedback.feedbackId !== 'room_phase_active' && feedback.feedbackId !== 'room_meeting_name') continue

		let changed = false
		for (const key of ['room', 'phase']) {
			const option = feedback.options[key]
			if (option && !option.isExpression && !Array.isArray(option.value)) {
				const blank = option.value === undefined || option.value === null || option.value === ''
				feedback.options[key] = { isExpression: false, value: blank ? [] : [option.value as string | number] }
				changed = true
			}
		}
		if (feedback.options.minutesBefore === undefined) {
			feedback.options.minutesBefore = { isExpression: false, value: 0 }
			changed = true
		}

		if (changed) updatedFeedbacks.push(feedback)
	}

	return { updatedConfig: null, updatedSecrets: null, updatedActions: [], updatedFeedbacks }
}

/** "Minutes after" was added. "Minutes before" now moves only the start, rather than the whole state. */
const addMinutesAfter: CompanionStaticUpgradeScript<ModuleConfig, ModuleSecrets> = (_context, props) => {
	const updatedFeedbacks: CompanionMigrationFeedback[] = []

	for (const feedback of props.feedbacks) {
		if (feedback.feedbackId !== 'room_phase_active' && feedback.feedbackId !== 'room_meeting_name') continue
		if (feedback.options.minutesAfter !== undefined) continue

		feedback.options.minutesAfter = { isExpression: false, value: 0 }
		updatedFeedbacks.push(feedback)
	}

	return { updatedConfig: null, updatedSecrets: null, updatedActions: [], updatedFeedbacks }
}

/** The "Any" phase was removed.  Selecting setup, event, and teardown together is the same thing. */
const removeAnyPhase: CompanionStaticUpgradeScript<ModuleConfig, ModuleSecrets> = (_context, props) => {
	const updatedFeedbacks: CompanionMigrationFeedback[] = []

	for (const feedback of props.feedbacks) {
		if (feedback.feedbackId !== 'room_phase_active') continue

		const option = feedback.options.phase
		if (!option || option.isExpression || !Array.isArray(option.value) || !option.value.includes('any')) continue

		const phases = new Set(option.value.filter((p) => p !== 'any'))
		for (const phase of ['setup', 'event', 'teardown']) phases.add(phase)
		feedback.options.phase = { isExpression: false, value: [...phases] }
		updatedFeedbacks.push(feedback)
	}

	return { updatedConfig: null, updatedSecrets: null, updatedActions: [], updatedFeedbacks }
}

export const UpgradeScripts: CompanionStaticUpgradeScript<ModuleConfig, ModuleSecrets>[] = [
	roomsAndPhasesBecomeLists,
	addMinutesAfter,
	removeAnyPhase,
]
