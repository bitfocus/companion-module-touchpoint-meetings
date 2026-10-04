/** "1.2.3" as [1, 2, 3], or undefined if it isn't a dotted number. */
export function parseVersion(text: unknown): number[] | undefined {
	if (typeof text !== 'string' || !/^\d+(\.\d+)*$/.test(text)) return undefined
	return text.split('.').map(Number)
}

/** Negative if `a` is older than `b`, positive if newer, zero if the same. Missing parts count as zero. */
export function compareVersions(a: number[], b: number[]): number {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const difference = (a[i] ?? 0) - (b[i] ?? 0)
		if (difference !== 0) return difference
	}
	return 0
}
