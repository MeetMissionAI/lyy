import { DEFAULT_STATE_PATH, type State, type ThreadSummary } from "@lyy/daemon";
import { existsSync, readFileSync } from "node:fs";

/**
 * Render the LYY statusLine string. Format (Phase-3 design § Appendix A):
 *   📬 #12 @jianfeng · #18 @sarah +4 more · 🧵 #8 active
 * Empty output (newline only) when no inbox + no active panes.
 */
export function renderStatusLine(state: State, opts: { maxShown?: number } = {}): string {
  const maxShown = opts.maxShown ?? 2;

  const isUnreadVisible = (t: ThreadSummary): boolean => t.unread > 0 && !t.archived;
  const isActive = (t: ThreadSummary): boolean => t.paneOpen && !t.archived;

  const unread = state.threads.filter(isUnreadVisible);
  const active = state.threads.find(isActive);

  if (unread.length === 0 && !active) return "";

  const parts: string[] = [];
  if (unread.length > 0) {
    const head = unread
      .slice(0, maxShown)
      .map((t) => `#${t.shortId} @${t.peerName}`)
      .join(" · ");
    const more = unread.length > maxShown ? ` +${unread.length - maxShown} more` : "";
    parts.push(`📬 ${head}${more}`);
  }
  if (active) parts.push(`🧵 #${active.shortId} active`);
  return parts.join(" · ");
}

export async function runStatusline(): Promise<void> {
  if (!existsSync(DEFAULT_STATE_PATH)) return;
  try {
    const state = JSON.parse(readFileSync(DEFAULT_STATE_PATH, "utf8")) as State;
    const line = renderStatusLine(state);
    if (line) process.stdout.write(line);
  } catch {
    // Silent — statusline must never break the prompt
  }
}
