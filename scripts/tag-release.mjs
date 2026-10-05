// Tags a release: the second half of Bitfocus's release process.
//
//   yarn release:tag
//
// The tag is made from the version that is in the files, never typed: so it can't disagree with package.json, which
// Bitfocus's release checks compare it against, or with the script that the module's settings link to at that tag.
//
// It tags the current commit, and refuses unless:
// - the working tree is clean, and this is the main branch (a release branch isn't merged yet, and a tag on a commit
//   that is squashed away would point at nothing once merged);
// - the version is the same in every place it is written down (otherwise, run `yarn release` first); and
// - the tag doesn't exist yet. (A tag that has been pushed should never be moved: people and the Developer Portal may
//   already have it.)
//
// It doesn't push; it says how.
import { pathToFileURL } from 'node:url'
import { projectRoot } from './embed-script.mjs'
import { git, gitSucceeds } from './release.mjs'
import { findVersionProblems, readVersions } from './set-version.mjs'

const MAIN_BRANCHES = ['main', 'master']

/** Tags the current commit as the version in the files, and returns the tag. Throws, having changed nothing, if it shouldn't. */
export function tagRelease(rootDirectory, { anyBranch = false } = {}) {
	const problems = findVersionProblems(rootDirectory)
	if (problems.length > 0) {
		throw new Error(
			`The version isn't the same everywhere:\n  ${problems.join('\n  ')}\nRun \`yarn release <version>\` to set it.`,
		)
	}

	const tag = `v${readVersions(rootDirectory).package}`
	const branch = git(rootDirectory, 'rev-parse', '--abbrev-ref', 'HEAD')
	if (!anyBranch && !MAIN_BRANCHES.includes(branch)) {
		throw new Error(
			`This is the branch ${branch}, not main. Merge the release pull request, then switch to main and pull, and run this there.`,
		)
	}
	if (git(rootDirectory, 'status', '--porcelain', '--untracked-files=no') !== '') {
		throw new Error('There are uncommitted changes. A tag has to be a commit that is exactly what is released.')
	}
	if (gitSucceeds(rootDirectory, 'rev-parse', '-q', '--verify', `refs/tags/${tag}`)) {
		throw new Error(
			`The tag ${tag} already exists. Tags that have been pushed are never moved; release a new version instead.`,
		)
	}

	git(rootDirectory, 'tag', '-a', tag, '-m', tag)
	return tag
}

function main(argv) {
	try {
		const tag = tagRelease(projectRoot(argv), { anyBranch: argv.includes('--any-branch') })
		console.log(
			`Tagged ${tag}.\n\nNext:\n  git push origin ${tag}\n  then submit ${tag} in the Bitfocus Developer Portal.`,
		)
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv)
