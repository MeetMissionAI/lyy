import { describe, expect, it } from "vitest";
import { generateCode } from "./admin.js";

describe("generateCode", () => {
  it("matches lyy-XXXXXXXX-YYYYYYYY format", () => {
    expect(generateCode()).toMatch(/^lyy-[a-f0-9]{8}-[a-f0-9]{8}$/);
  });

  it("returns unique codes across calls", () => {
    const codes = new Set(Array.from({ length: 10 }, () => generateCode()));
    expect(codes.size).toBe(10);
  });
});
