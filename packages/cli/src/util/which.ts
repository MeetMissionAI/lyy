import { execSync } from "node:child_process";

/** Resolve a binary on PATH, returning its absolute path or null. */
export function which(cmd: string): string | null {
  try {
    const result = execSync(`command -v ${cmd}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return result.trim() || null;
  } catch {
    return null;
  }
}
