import type ModuleInstance from './main.js'

export type VariablesSchema = {
	rooms_loaded: string
	monitored_rooms: string
	upcoming_reservations: string
	last_refresh_time: string
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	self.setVariableDefinitions({
		rooms_loaded: { name: 'Number of rooms known from TouchPoint' },
		monitored_rooms: { name: 'Number of rooms being watched by feedbacks' },
		upcoming_reservations: { name: 'Number of current and upcoming reservations for watched rooms' },
		last_refresh_time: { name: 'Last successful refresh from TouchPoint (ISO)' },
	})
}
