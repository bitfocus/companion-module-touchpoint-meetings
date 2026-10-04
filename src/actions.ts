import type ModuleInstance from './main.js'

export type ActionsSchema = {
	refresh: { options: Record<string, never> }
}

export function UpdateActions(self: ModuleInstance): void {
	self.setActionDefinitions({
		refresh: {
			name: 'Refresh from TouchPoint',
			description: 'Reload the room list and reservations now, rather than waiting for the next refresh.',
			options: [],
			callback: async () => {
				await self.refreshNow()
			},
		},
	})
}
