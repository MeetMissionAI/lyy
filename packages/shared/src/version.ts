/**
 * Single source of truth for the LYY runtime version. Bumped alongside
 * git tags (v0.X.Y). Daemon returns this in the `version` IPC handshake;
 * the CLI compares its own import against the daemon's reply and restarts
 * the daemon on mismatch so users don't get stuck on old code after an
 * upgrade.
 */
export const LYY_VERSION = "0.2.4";
