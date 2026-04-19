import { McpIpcClient } from "@lyy/daemon";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runHook } from "./hook.js";

const ORIGINAL_ENV = { ...process.env };

let stdoutBuf = "";
const originalWrite = process.stdout.write.bind(process.stdout);

beforeEach(() => {
  stdoutBuf = "";
  (process.stdout.write as unknown as (s: string) => boolean) = (s: string) => {
    stdoutBuf += s;
    return true;
  };
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("LYY_") || k === "ZELLIJ_PANE_ID") delete process.env[k];
  }
});

afterEach(() => {
  process.stdout.write = originalWrite;
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("runHook", () => {
  it("main mode (no LYY_MODE): no-op, no output", async () => {
    await runHook("session-start");
    await runHook("prompt-submit");
    await runHook("stop");
    expect(stdoutBuf).toBe("");
  });

  it("thread mode SessionStart: injects thread history", async () => {
    process.env.LYY_MODE = "thread";
    process.env.LYY_THREAD_ID = "550e8400-e29b-41d4-a716-446655440000";
    process.env.LYY_THREAD_SHORT_ID = "12";

    vi.spyOn(McpIpcClient.prototype, "call").mockImplementation(
      async (method) => {
        if (method === "read_thread") {
          return {
            messages: [
              {
                fromPeer: "peer-a",
                body: "hi",
                sentAt: "2026-04-19T10:00:00Z",
              },
              {
                fromPeer: "peer-a",
                body: "you up?",
                sentAt: "2026-04-19T10:01:00Z",
              },
            ],
          };
        }
        throw new Error(`unexpected ${method}`);
      },
    );

    await runHook("session-start");
    const parsed = JSON.parse(stdoutBuf);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("thread #12");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("hi");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("you up?");
  });

  it("thread mode UserPromptSubmit with no pending: no output", async () => {
    process.env.LYY_MODE = "thread";
    process.env.LYY_THREAD_ID = "550e8400-e29b-41d4-a716-446655440000";
    process.env.LYY_THREAD_SHORT_ID = "12";

    vi.spyOn(McpIpcClient.prototype, "call").mockResolvedValue([]);
    await runHook("prompt-submit");
    expect(stdoutBuf).toBe("");
  });

  it("thread mode UserPromptSubmit with pending: emits additionalContext", async () => {
    process.env.LYY_MODE = "thread";
    process.env.LYY_THREAD_ID = "550e8400-e29b-41d4-a716-446655440000";
    process.env.LYY_THREAD_SHORT_ID = "12";

    vi.spyOn(McpIpcClient.prototype, "call").mockResolvedValue([
      {
        message: {
          fromPeer: "leo",
          body: "Lottie 1.2MB",
          sentAt: "2026-04-19T10:30:00Z",
        },
        receivedAt: "2026-04-19T10:30:00Z",
      },
    ]);

    await runHook("prompt-submit");
    const parsed = JSON.parse(stdoutBuf);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "1 new peer message",
    );
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "Lottie 1.2MB",
    );
  });

  it("hook never crashes when McpIpcClient throws", async () => {
    process.env.LYY_MODE = "thread";
    process.env.LYY_THREAD_ID = "550e8400-e29b-41d4-a716-446655440000";
    process.env.LYY_THREAD_SHORT_ID = "12";

    vi.spyOn(McpIpcClient.prototype, "call").mockRejectedValue(
      new Error("daemon down"),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(runHook("prompt-submit")).resolves.toBeUndefined();
    expect(stdoutBuf).toBe("");
  });
});
