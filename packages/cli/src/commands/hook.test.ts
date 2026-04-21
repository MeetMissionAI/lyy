import { describe, expect, it } from "vitest";
import { runHook } from "./hook.js";

describe("runHook", () => {
  it("returns without output (no-op after TUI replaces thread panes)", async () => {
    await expect(runHook("session-start")).resolves.toBeUndefined();
    await expect(runHook("prompt-submit")).resolves.toBeUndefined();
    await expect(runHook("stop")).resolves.toBeUndefined();
  });
});
