import { describe, expect, it } from "vitest";
import { compareVersion, isDevInstall, parseVersion } from "./upgrade.js";

describe("parseVersion", () => {
  it("accepts v-prefixed and plain tags", () => {
    expect(parseVersion("v0.2.7")).toEqual([0, 2, 7]);
    expect(parseVersion("0.2.7")).toEqual([0, 2, 7]);
  });
  it("ignores pre-release suffix after patch", () => {
    expect(parseVersion("v1.2.3-beta")).toEqual([1, 2, 3]);
  });
  it("throws on garbage", () => {
    expect(() => parseVersion("banana")).toThrow();
  });
});

describe("compareVersion", () => {
  it("orders major > minor > patch", () => {
    expect(compareVersion("v1.0.0", "v0.9.9")).toBeGreaterThan(0);
    expect(compareVersion("v0.2.8", "v0.2.7")).toBeGreaterThan(0);
    expect(compareVersion("v0.2.7", "v0.2.7")).toBe(0);
    expect(compareVersion("0.2.7", "0.2.8")).toBeLessThan(0);
  });
});

describe("isDevInstall", () => {
  it("returns true when binary sits under a source checkout", () => {
    expect(
      isDevInstall(
        "/Users/me/code/lyy/packages/cli/bin/lyy-dev",
        "/Users/me/.lyy",
      ),
    ).toBe(true);
  });

  it("returns false for a bootstrap install under runtime", () => {
    expect(
      isDevInstall("/Users/me/.lyy/runtime/cli/bin/lyy", "/Users/me/.lyy"),
    ).toBe(false);
  });
});
