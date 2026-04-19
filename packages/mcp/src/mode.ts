export type Mode =
  | { kind: "main" }
  | { kind: "thread"; threadId: string; threadShortId: number };

/**
 * Detect MCP mode from environment. Set LYY_MODE=thread plus
 * LYY_THREAD_ID and LYY_THREAD_SHORT_ID inside thread panes (the
 * SessionStart hook is responsible for exporting these before claude).
 */
export function detectMode(env: NodeJS.ProcessEnv = process.env): Mode {
  if (env.LYY_MODE !== "thread") return { kind: "main" };
  const threadId = env.LYY_THREAD_ID;
  const shortId = env.LYY_THREAD_SHORT_ID;
  if (!threadId || !shortId) return { kind: "main" };
  const parsed = Number.parseInt(shortId, 10);
  if (!Number.isFinite(parsed)) return { kind: "main" };
  return { kind: "thread", threadId, threadShortId: parsed };
}
