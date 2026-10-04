import type { ModuleSchema } from './main.js'
import type ModuleInstance from './main.js'
import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'

const PHASES = [
	{ id: 'setup', label: 'Setup', bgcolor: 0xff8a00, color: 0x000000 },
	{ id: 'event', label: 'In Use', bgcolor: 0x00aa00, color: 0xffffff },
	{ id: 'teardown', label: 'Teardown', bgcolor: 0x2962ff, color: 0xffffff },
	{ id: 'reserved', label: 'Reserved', bgcolor: 0x7b1fa2, color: 0xffffff },
] as const

export function UpdatePresets(self: ModuleInstance): void {
	const structure: CompanionPresetSection[] = [
		{
			id: 'room_status',
			name: 'Room Status',
			description:
				'After adding one, choose its room in the feedback. Use the same feedbacks as conditions in a Trigger to start and stop things.',
			definitions: [
				{
					id: 'room_status_buttons',
					name: 'Room status',
					type: 'simple',
					presets: PHASES.map((p) => `room_${p.id}`),
				},
			],
		},
	]

	const presets: CompanionPresetDefinitions<ModuleSchema> = {}
	for (const p of PHASES) {
		presets[`room_${p.id}`] = {
			type: 'simple',
			name: p.label,
			style: {
				text: p.label,
				size: 'auto',
				color: 0xffffff,
				bgcolor: 0x1f1f1f,
			},
			steps: [],
			feedbacks: [
				{
					feedbackId: 'room_phase_active',
					options: {
						room: [],
						includeChildren: false,
						minutesBefore: 0,
						minutesAfter: 0,
						phase: p.id === 'reserved' ? ['setup', 'event', 'teardown'] : [p.id],
					},
					style: { bgcolor: p.bgcolor, color: p.color },
				},
			],
		}
	}

	self.setPresetDefinitions(structure, presets)
}
