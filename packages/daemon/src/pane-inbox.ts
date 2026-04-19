import { existsSync, mkdirSync } from "node:fs";
import { appendFile, readFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { Message } from "@lyy/shared";

export const DEFAULT_INBOX_DIR = resolve(homedir(), ".lyy", "inbox");

export interface PaneInboxEntry {
  message: Message;
  receivedAt: string; // ISO
}

/**
 * Per-thread file inbox: each open thread pane has its own
 * `<dir>/thread-<shortId>.jsonl`. The daemon appends one line when a
 * new peer message arrives. The pane's UserPromptSubmit hook reads and
 * truncates the file before each user turn, surfacing any new lines as
 * a system-reminder injection (so peer chatter shows up at the next turn).
 */
export class PaneInbox {
  constructor(private readonly dir: string = DEFAULT_INBOX_DIR) {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  pathFor(threadShortId: number): string {
    return resolve(this.dir, `thread-${threadShortId}.jsonl`);
  }

  async append(threadShortId: number, message: Message): Promise<void> {
    const entry: PaneInboxEntry = { message, receivedAt: new Date().toISOString() };
    await appendFile(this.pathFor(threadShortId), `${JSON.stringify(entry)}\n`, "utf8");
  }

  /** Read pending entries and atomically truncate. Returns [] when empty. */
  async drain(threadShortId: number): Promise<PaneInboxEntry[]> {
    const path = this.pathFor(threadShortId);
    if (!existsSync(path)) return [];
    const raw = await readFile(path, "utf8");
    if (!raw.trim()) {
      await unlink(path).catch(() => undefined);
      return [];
    }
    const entries: PaneInboxEntry[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed) as PaneInboxEntry);
      } catch {
        // skip malformed line; better to lose one than block the pane
      }
    }
    await unlink(path).catch(() => undefined);
    return entries;
  }
}
