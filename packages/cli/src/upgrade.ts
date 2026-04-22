/** Parse `vX.Y.Z` or `X.Y.Z` (any suffix ignored) into [major, minor, patch]. */
export function parseVersion(tag: string): [number, number, number] {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(tag);
  if (!m) throw new Error(`bad version tag: ${tag}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Returns -1/0/1 like strcmp. Only major.minor.patch is compared. */
export function compareVersion(a: string, b: string): number {
  const [a1, a2, a3] = parseVersion(a);
  const [b1, b2, b3] = parseVersion(b);
  return a1 - b1 || a2 - b2 || a3 - b3;
}
