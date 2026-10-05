// Prepares a release: the first half of Bitfocus's release process.
//
//   yarn release 1.2.3
//
// Bitfocus's process is: bump the version, merge to main with CI green, tag vX.Y.Z from main, then submit that tag in
// the Developer Portal. Their checks compare the tag against package.json, so the version has to be in the commit that
// gets tagged, which is why it is bumped first and tagged afterwards. (And the module's settings link to the TouchPoint
// script at the tag, so that has to say the same version too.) This does the bump, in one commit, on a release branch:
//
// 1. refuses to start unless the working tree is clean, the version is newer than the current one, and its tag and
//    branch don't exist yet;
// 2. creates the branch release/vX.Y.Z (unless --no-branch);
// 3. sets the version everywhere it is written down (see set-version.mjs);
// 4. commits that as "Release vX.Y.Z".
//
// Then it says what to do next. `yarn release:tag` does the tagging, once the pull request is merged.
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { projectRoot } from './embed-script.mjs'
import { compareVersions, parseVersion } from './semver.mjs'
import { readVersions, setVersion, versionFromTag } from './set-version.mjs'

/** The files a version change touches, and so the files the release commit is made of. */
export const VERSIONED_FILES = [
	'package.json',
	'companion/manifest.json',
	'touchpoint/CompanionMeetings.py',
	'src/scriptSource.ts',
]

export function git(rootDirectory, ...args) {
	return execFileSync('git', args, { cwd: rootDirectory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

export function gitSucceeds(rootDirectory, ...args) {
	try {
		git(rootDirectory, ...args)
		return true
	} catch {
		return false
	}
}

/** Prepares the release, and returns what it did. Throws, without having changed anything, if it shouldn't. */
export function prepareRelease(rootDirectory, requested, { branch = true } = {}) {
	const version = versionFromTag(requested)
	const tag = `v${version}`
	const releaseBranch = `release/${tag}`

	const current = readVersions(rootDirectory).package
	if (compareVersions(parseVersion(version), parseVersion(current)) <= 0) {
		throw new Error(`${version} is not newer than the current version, ${current}.`)
	}
	if (git(rootDirectory, 'status', '--porcelain', '--untracked-files=no') !== '') {
		throw new Error(
			'There are uncommitted changes. Commit or stash them first, so the release commit is only the version.',
		)
	}
	if (gitSucceeds(rootDirectory, 'rev-parse', '-q', '--verify', `refs/tags/${tag}`)) {
		throw new Error(`The tag ${tag} already exists.`)
	}
	if (branch && gitSucceeds(rootDirectory, 'rev-parse', '-q', '--verify', `refs/heads/${releaseBranch}`)) {
		throw new Error(`The branch ${releaseBranch} already exists.`)
	}

	if (branch) git(rootDirectory, 'switch', '-c', releaseBranch)
	setVersion(rootDirectory, version)
	git(rootDirectory, 'add', '--', ...VERSIONED_FILES)
	git(rootDirectory, 'commit', '-m', `Release ${tag}`)

	return { version, tag, branch: branch ? releaseBranch : git(rootDirectory, 'rev-parse', '--abbrev-ref', 'HEAD') }
}

function main(argv) {
	const argument = argv.slice(2).find((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--root')
	if (!argument) {
		console.error('Usage: yarn release <version>, such as 1.2.3')
		process.exitCode = 2
		return
	}

	try {
		const { version, tag, branch } = prepareRelease(projectRoot(argv), argument, {
			branch: !argv.includes('--no-branch'),
		})
		console.log(`Prepared ${tag} on the branch ${branch}: the version is ${version} everywhere it is written down.

Next:
  1. yarn test && yarn test:py       (CI will run these too)
  2. git push -u origin ${branch}
     then open a pull request, wait for CI, and merge it
  3. git switch main && git pull
  4. yarn release:tag               (tags main as ${tag})
  5. git push origin ${tag}
  6. In the Bitfocus Developer Portal: My Connections > this module > Submit Version > choose ${tag}`)
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv)
