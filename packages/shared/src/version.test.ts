import { describe, expect, it } from "vitest";
import { LYY_VERSION } from "./version.js";

describe("LYY_VERSION", () => {
  it("is a semver string", () => {
    expect(LYY_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
