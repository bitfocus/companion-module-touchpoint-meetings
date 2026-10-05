// Sets the version everywhere it is written down:
//
//   node scripts/set-version.mjs 1.2.3
//   yarn version:set 1.2.3-beta.1
//
// The module and the TouchPoint script are released together and have one version. It is written in several places,
// and has to be the same in all of them, in the commit that gets tagged: Bitfocus's release checks compare the tag
// against package.json, and the link in the module's settings points at the script as it is at the tag. So the version
// is set *before* the tag exists. `yarn release` does that, as a commit to merge; `yarn release:tag` then tags it.
//
// This writes:
// - package.json and companion/manifest.json: the `version`
// - touchpoint/CompanionMeetings.py and src/scriptSource.ts, through embed-script.mjs
//
// It can also be run on its own, for example to try a change in TouchPoint under a version that counts as newer than the
// last (see the README), without committing it.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { embed, projectRoot } from './embed-script.mjs'
import { parseVersion } from './semver.mjs'

const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/

/** "v1.2.3", "refs/tags/v1.2.3", or "1.2.3" as "1.2.3". Throws if it isn't a version. */
export function versionFromTag(tag) {
	const version = String(tag ?? '')
		.trim()
		.replace(/^refs\/tags\//, '')
		.replace(/^v/, '')
	if (!VERSION.test(version)) {
		throw new Error(`"${tag}" is not a version, or a tag for one. Expected something like v1.2.3 or v1.2.3-beta.1`)
	}
	return version
}

/** Changes the "version" line in a JSON file, leaving everything else (including how it is formatted) as it was. */
function setJsonVersion(file, version) {
	const text = readFileSync(file, 'utf8')
	const line = /^(\s*"version":\s*)"[^"]*"/m
	if (!line.test(text)) throw new Error(`${file} has no "version"`)
	writeFileSync(file, text.replace(line, `$1"${version}"`))
}

/**
 * The version as each place that holds it says, in the project at `rootDirectory`: `package`, `manifest`, `script`
 * (the script's VERSION), and `embedded` (the module's copy of it).
 */
export function readVersions(rootDirectory) {
	const read = (relativePath) => readFileSync(path.join(rootDirectory, relativePath), 'utf8')
	return {
		package: JSON.parse(read('package.json')).version,
		manifest: JSON.parse(read('companion/manifest.json')).version,
		script: /^VERSION = "([^"]*)"/m.exec(read('touchpoint/CompanionMeetings.py'))?.[1],
		embedded: /MODULE_VERSION = "([^"]*)"/.exec(read('src/scriptSource.ts'))?.[1],
	}
}

/** What is wrong with the versions, if they aren't all the same. Empty if they are. */
export function findVersionProblems(rootDirectory) {
	const versions = readVersions(rootDirectory)
	const places = {
		package: 'package.json',
		manifest: 'companion/manifest.json',
		script: "touchpoint/CompanionMeetings.py's VERSION",
		embedded: 'src/scriptSource.ts',
	}

	const problems = []
	if (!parseVersion(versions.package)) problems.push(`package.json's version, "${versions.package}", is not a version`)
	for (const key of ['manifest', 'script', 'embedded']) {
		if (versions[key] !== versions.package) {
			problems.push(`${places[key]} says ${versions[key]}, but package.json says ${versions.package}`)
		}
	}
	return problems
}

export function setVersion(rootDirectory, tag) {
	const version = versionFromTag(tag)
	setJsonVersion(path.join(rootDirectory, 'package.json'), version)
	setJsonVersion(path.join(rootDirectory, 'companion/manifest.json'), version)
	embed(rootDirectory)
	return version
}

function main(argv) {
	const argument = argv.slice(2).find((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--root')
	if (!argument) {
		console.error('Usage: node scripts/set-version.mjs <version or tag>, such as v1.2.3')
		process.exitCode = 2
		return
	}
	try {
		console.log(`Version set to ${setVersion(projectRoot(argv), argument)}`)
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv)
