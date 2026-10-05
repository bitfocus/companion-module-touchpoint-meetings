import { MODULE_VERSION, REPOSITORY_URL, SCRIPT_PATH } from './scriptSource.js'

/**
 * Where to find the TouchPoint script that goes with a version of this module (they have one version): the file as
 * it is at the tag for that release (a "v" and the version).
 */
export function scriptUrl(repositoryUrl: string, moduleVersion: string, scriptPath: string): string {
	return `${repositoryUrl}/blob/v${moduleVersion}/${scriptPath}`
}

/** The script that goes with this version of the module. */
export const SCRIPT_URL = scriptUrl(REPOSITORY_URL, MODULE_VERSION, SCRIPT_PATH)

/**
 * The introduction to the TouchPoint script, shown at the top of the connection's settings.
 *
 * Companion shows this as HTML, with a limited set of tags. The link goes to the script that matches this version of
 * the module; the version isn't written out, since it isn't something anyone has to match by hand.
 */
export function scriptIntroduction(url: string = SCRIPT_URL): string {
	return (
		'<p>This module reads room reservations through a script that runs inside TouchPoint.</p>' +
		'<ol>' +
		`<li>Install the <a href="${url}" target="_blank">CompanionMeetings script</a> as a Python script in ` +
		'<b>Admin &gt; Advanced &gt; Special Content &gt; Python Scripts</b>, keeping that name. ' +
		'You only do this once. After that, this module keeps it up to date.</li>' +
		'<li>Create a TouchPoint user with the <b>Developer</b> and <b>APIOnly</b> roles, and enter its login below. ' +
		'We recommend using a dedicated service account for this purpose.  If you do not see the Developer role as an ' +
		'option, open a support ticket with TouchPoint.</li>' +
		'</ol>' +
		'<p>Rooms are chosen in each feedback, so one connection can serve every room.</p>'
	)
}
