import { describe, expect, it } from "vitest";
import { detectMode } from "./mode.js";

describe("detectMode", () => {
  it("returns main mode by default", () => {
    expect(detectMode({})).toEqual({ kind: "main" });
  });

  it("returns thread mode when env vars are set", () => {
    expect(
      detectMode({
        LYY_MODE: "thread",
        LYY_THREAD_ID: "550e8400-e29b-41d4-a716-446655440000",
        LYY_THREAD_SHORT_ID: "12",
      }),
    ).toEqual({
      kind: "thread",
      threadId: "550e8400-e29b-41d4-a716-446655440000",
      threadShortId: 12,
    });
  });

  it("falls back to main when LYY_MODE=thread but threadId missing", () => {
    expect(
      detectMode({ LYY_MODE: "thread", LYY_THREAD_SHORT_ID: "12" }),
    ).toEqual({ kind: "main" });
  });

  it("falls back to main when LYY_THREAD_SHORT_ID is non-numeric", () => {
    expect(
      detectMode({
        LYY_MODE: "thread",
        LYY_THREAD_ID: "550e8400-e29b-41d4-a716-446655440000",
        LYY_THREAD_SHORT_ID: "not-a-number",
      }),
    ).toEqual({ kind: "main" });
  });

  it("ignores stray LYY_MODE values other than 'thread'", () => {
    expect(detectMode({ LYY_MODE: "weird" })).toEqual({ kind: "main" });
  });
});
