import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * Root of per-profile LYY state (identity, state.json, sockets, inbox).
 * `LYY_HOME` env var lets the CLI's `--profile NAME` flag redirect all
 * paths to `~/.lyy/profiles/NAME`. Unset = default `~/.lyy`.
 */
export function getLyyHome(): string {
  return process.env.LYY_HOME ?? resolve(homedir(), ".lyy");
}

/** Join segments under `getLyyHome()`. */
export function lyyPath(...segments: string[]): string {
  return resolve(getLyyHome(), ...segments);
}
