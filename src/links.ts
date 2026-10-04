import { MODULE_VERSION, REPOSITORY_URL, SCRIPT_PATH, SCRIPT_VERSION } from './scriptSource.js'

/**
 * Where to find the TouchPoint script that goes with a version of this module: the file as it is at the tag for that
 * release (a "v" and the module's version).
 */
export function scriptUrl(repositoryUrl: string, moduleVersion: string, scriptPath: string): string {
	return `${repositoryUrl}/blob/v${moduleVersion}/${scriptPath}`
}

/** The script that goes with this version of the module. */
export const SCRIPT_URL = scriptUrl(REPOSITORY_URL, MODULE_VERSION, SCRIPT_PATH)

/**
 * The introduction to the TouchPoint script, shown at the top of the connection's settings.
 *
 * Companion shows this as HTML, with a limited set of tags, so a link is a plain <a>. The address is also written out,
 * in case a link isn't clickable where this is shown.
 */
export function scriptIntroduction(url: string = SCRIPT_URL, scriptVersion: string = SCRIPT_VERSION): string {
	return (
		'This module reads room reservations through a script in TouchPoint. ' +
		'Install it once, in <b>Admin &gt; Advanced &gt; Special Content &gt; Python Scripts</b>, ' +
		'and keep its name as set below. After that, this module keeps it up to date.<br />' +
		`<a href="${url}" target="_blank">Get script version ${scriptVersion}</a> (${url})<br />` +
		'Then enter the credentials of a TouchPoint user with the <b>Developer</b> and <b>APIOnly</b> roles. ' +
		'Rooms are chosen in each feedback, so one connection can serve every room.'
	)
}
