export type HookEvent = "session-start" | "prompt-submit" | "stop";

/**
 * Thread-mode injection removed — LYY TUI now surfaces thread history
 * directly. Hook stays registered so existing Claude settings.json doesn't
 * break, but emits nothing. Users can un-register by editing settings.json
 * or running `lyy repair` (which re-writes without hook, once updated).
 */
export async function runHook(_event: HookEvent): Promise<void> {
  // no-op
}
