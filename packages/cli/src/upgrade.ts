import { sep } from "node:path";

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

/**
 * A "dev install" is any lyy invocation whose CLI binary does NOT live under
 * `<LYY_HOME>/runtime/`. That matches both the in-repo tsx shim and any hand-
 * rolled symlink pointing at a checkout. Dev installs always skip auto-upgrade
 * so we don't fight the developer's own working tree.
 */
export function isDevInstall(argv0: string, lyyHome: string): boolean {
  const runtimeMarker = `${lyyHome}${sep}runtime${sep}`;
  return !argv0.startsWith(runtimeMarker);
}
