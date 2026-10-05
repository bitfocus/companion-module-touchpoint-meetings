export type Version = { core: [number, number, number]; prerelease?: string[] }
export function parseVersion(text: unknown): Version | undefined
export function compareVersions(a: Version, b: Version): number
