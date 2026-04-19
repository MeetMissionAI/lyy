import { describe, expect, it } from "vitest";
import { which } from "./which.js";

describe("which", () => {
  it("resolves a binary that exists (sh)", () => {
    const path = which("sh");
    expect(path).toBeTruthy();
    expect(path).toMatch(/sh$/);
  });

  it("returns null for a non-existent binary", () => {
    expect(which("definitely-not-installed-binary-xyz")).toBeNull();
  });
});
