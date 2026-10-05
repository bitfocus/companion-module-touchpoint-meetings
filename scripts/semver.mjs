// Semantic versioning, for the release scripts: what is a version, and which of two is newer.
//
// The module (src/version.ts) and the TouchPoint script (touchpoint/CompanionMeetings.py) each compare versions too, by
// the same rules. They are all tested against the same list of cases (test/fixtures/version-comparisons.json), so they
// can't disagree.

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/

/** The version in the text, as { core: [major, minor, patch], prerelease?: string[] }, or undefined if it isn't one. */
export function parseVersion(text) {
	const match = typeof text === 'string' ? VERSION.exec(text) : null
	if (!match) return undefined

	return {
		core: [Number(match[1]), Number(match[2]), Number(match[3])],
		prerelease: match[4] ? match[4].split('.') : undefined,
	}
}

const isNumber = (identifier) => /^\d+$/.test(identifier)

/** Negative if `a` is older than `b`, zero if they are the same, and positive if `a` is newer. */
export function compareVersions(a, b) {
	for (let i = 0; i < 3; i++) {
		if (a.core[i] !== b.core[i]) return a.core[i] < b.core[i] ? -1 : 1
	}

	// A release is newer than a pre-release of it.
	if (!a.prerelease || !b.prerelease) return Number(!a.prerelease) - Number(!b.prerelease)

	for (let i = 0; i < Math.min(a.prerelease.length, b.prerelease.length); i++) {
		const [x, y] = [a.prerelease[i], b.prerelease[i]]
		if (x === y) continue
		if (isNumber(x) && isNumber(y)) return Number(x) < Number(y) ? -1 : 1
		if (isNumber(x) || isNumber(y)) return isNumber(x) ? -1 : 1 // numbers rank below text
		return x < y ? -1 : 1
	}
	return Math.sign(a.prerelease.length - b.prerelease.length) // more parts is newer, if the rest is the same
}
