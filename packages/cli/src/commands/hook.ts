import { McpIpcClient, type PaneInboxEntry } from "@lyy/daemon";

export type HookEvent = "session-start" | "prompt-submit" | "stop";

interface HookOutput {
  hookSpecificOutput: {
    hookEventName: string;
    additionalContext?: string;
  };
}

const HOOK_EVENT_NAMES: Record<HookEvent, string> = {
  "session-start": "SessionStart",
  "prompt-submit": "UserPromptSubmit",
  stop: "Stop",
};

/**
 * Single dispatcher for all LYY-installed hooks. Reads the JSON payload
 * Claude Code sends on stdin (we ignore it for v1 — env is enough), and
 * emits a HookOutput JSON if there's anything to inject.
 *
 * In thread mode (LYY_MODE=thread + LYY_THREAD_*):
 *   SessionStart → load full thread history into context
 *   UserPromptSubmit / Stop → drain pane inbox; inject any pending peer msgs
 *
 * In main mode: no-op (statusLine already surfaces the inbox).
 */
export async function runHook(event: HookEvent): Promise<void> {
  const eventName = HOOK_EVENT_NAMES[event];
  const threadMode = readThreadMode(process.env);
  if (!threadMode) {
    return; // main mode: no injection
  }

  let body = "";
  try {
    if (event === "session-start") {
      body = await sessionStartContext(threadMode);
    } else {
      body = await drainInboxContext(threadMode);
    }
  } catch (err) {
    // Hooks must never crash Claude. Log to stderr (visible only on --debug).
    console.error(`[lyy-hook ${event}]`, err);
    return;
  }
  if (!body) return;

  const out: HookOutput = {
    hookSpecificOutput: { hookEventName: eventName, additionalContext: body },
  };
  process.stdout.write(JSON.stringify(out));
}

interface ThreadMode {
  threadId: string;
  threadShortId: number;
  paneId: string;
}

function readThreadMode(env: NodeJS.ProcessEnv): ThreadMode | null {
  if (env.LYY_MODE !== "thread") return null;
  const threadId = env.LYY_THREAD_ID;
  const shortRaw = env.LYY_THREAD_SHORT_ID;
  if (!threadId || !shortRaw) return null;
  const shortId = Number.parseInt(shortRaw, 10);
  if (!Number.isFinite(shortId)) return null;
  return {
    threadId,
    threadShortId: shortId,
    paneId: env.ZELLIJ_PANE_ID ?? `pid-${process.pid}`,
  };
}

async function sessionStartContext(mode: ThreadMode): Promise<string> {
  const ipc = new McpIpcClient();
  const { messages } = await ipc.call<{
    messages: { fromPeer: string; body: string; sentAt: string }[];
  }>("read_thread", { threadId: mode.threadId });
  if (!messages.length) {
    return `LYY thread #${mode.threadShortId}: no messages yet.`;
  }
  const lines = messages.map((m) => `[${m.sentAt}] ${m.fromPeer}: ${m.body}`);
  return `You are in LYY peer thread #${mode.threadShortId} (${mode.threadId}).
You can use the 'reply' tool to respond. Thread history:

${lines.join("\n")}`;
}

async function drainInboxContext(mode: ThreadMode): Promise<string> {
  const ipc = new McpIpcClient();
  const entries = await ipc.call<PaneInboxEntry[]>("drain_pane_inbox", {
    threadShortId: mode.threadShortId,
  });
  if (!entries.length) return "";
  const lines = entries.map(
    (e) =>
      `[${e.message.sentAt}] from ${e.message.fromPeer}: ${e.message.body}`,
  );
  return `📬 ${entries.length} new peer message${entries.length > 1 ? "s" : ""} since last turn:

${lines.join("\n")}`;
}
