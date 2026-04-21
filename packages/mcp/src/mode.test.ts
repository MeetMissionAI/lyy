import { describe, expect, it } from "vitest";
import { detectMode } from "./mode.js";

describe("detectMode", () => {
  it("always returns main mode", () => {
    expect(detectMode()).toEqual({ kind: "main" });
  });
});
