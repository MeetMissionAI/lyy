import { existsSync, mkdirSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { lyyPath } from "./paths.js";

const ThreadSummarySchema = z.object({
  threadId: z.uuid(),
  shortId: z.number().int().positive(),
  peerName: z.string(),
  lastBody: z.string(),
  unread: z.number().int().nonnegative(),
  lastMessageAt: z.iso.datetime(),
  archived: z.boolean(),
  /** Local-only: whether this thread currently has an open pane on this machine. */
  paneOpen: z.boolean(),
});

export const StateSchema = z.object({
  unreadCount: z.number().int().nonnegative(),
  threads: z.array(ThreadSummarySchema),
  /** Per-thread highest-seq we've persisted; used as the `since` cursor on reconnect. */
  lastSeenSeq: z.record(z.uuid(), z.number().int().nonnegative()),
});

export type State = z.infer<typeof StateSchema>;
export type ThreadSummary = z.infer<typeof ThreadSummarySchema>;

export const DEFAULT_STATE_PATH = lyyPath("state.json");

const EMPTY_STATE: State = { unreadCount: 0, threads: [], lastSeenSeq: {} };

/**
 * Atomic JSON state store at ~/.lyy/state.json. Used by:
 *   - statusLine command (read)
 *   - daemon (read+write on every relay event)
 * Writes go to a tmp file then rename, so a crash mid-write can never
 * leave a half-written JSON for the statusLine to choke on.
 */
export class StateStore {
  constructor(private readonly path: string = DEFAULT_STATE_PATH) {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  async read(): Promise<State> {
    if (!existsSync(this.path)) return { ...EMPTY_STATE };
    const raw = await readFile(this.path, "utf8");
    if (!raw.trim()) return { ...EMPTY_STATE };
    const parsed = StateSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(`Invalid state at ${this.path}: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  async write(state: State): Promise<void> {
    StateSchema.parse(state); // throw early on bad shape
    const tmp = `${this.path}.tmp.${process.pid}.${Date.now()}`;
    await writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
    await rename(tmp, this.path);
  }

  /** Read-modify-write helper. Not concurrency-safe; caller serializes. */
  async update(fn: (state: State) => State | Promise<State>): Promise<State> {
    const next = await fn(await this.read());
    await this.write(next);
    return next;
  }
}
