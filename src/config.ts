import { Regex, type SomeCompanionConfigField } from '@companion-module/base'
import { scriptIntroduction } from './links.js'

export type ModuleConfig = {
	host: string
	username: string
	scriptName: string
	pollIntervalSeconds: number
	requestTimeoutMs: number
	autoUpdateScript: boolean
}

export type ModuleSecrets = {
	password?: string
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			label: 'TouchPoint script',
			width: 12,
			value: scriptIntroduction(),
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'TouchPoint Host',
			tooltip: 'Host name only, without https://. Example: mychurch.tpsdb.com',
			width: 8,
			default: '',
			regex: Regex.HOSTNAME,
		},
		{
			type: 'textinput',
			id: 'scriptName',
			label: 'Python Script Name',
			tooltip: 'The name of the script in TouchPoint, which must begin with #API',
			width: 4,
			default: 'CompanionMeetings',
			regex: '/^[A-Za-z0-9_.-]+$/',
		},
		{
			type: 'textinput',
			id: 'username',
			label: 'API Username',
			width: 6,
			default: '',
		},
		{
			type: 'secret-text',
			id: 'password',
			label: 'API Password',
			width: 6,
		},
		{
			type: 'checkbox',
			id: 'autoUpdateScript',
			label: 'Update the TouchPoint script automatically',
			tooltip:
				'When this module has a newer version of the script than the one in TouchPoint, install it over the old one. Requires the script to already be installed once.',
			width: 12,
			default: true,
		},
		{
			type: 'number',
			id: 'pollIntervalSeconds',
			label: 'Refresh Interval (seconds)',
			tooltip:
				'How often reservations are re-read from TouchPoint. Start and end times are applied to the second between refreshes.',
			width: 6,
			min: 10,
			max: 600,
			default: 30,
		},
		{
			type: 'number',
			id: 'requestTimeoutMs',
			label: 'Request Timeout (ms)',
			width: 6,
			min: 1000,
			max: 60000,
			default: 10000,
		},
	]
}
