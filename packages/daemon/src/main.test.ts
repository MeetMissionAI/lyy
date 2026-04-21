import { describe, expect, it, vi } from "vitest";
import { inspectPidLock } from "./main.js";

function deps(opts: { pidFile?: string; alivePids?: number[] } = {}) {
  const alive = new Set(opts.alivePids ?? []);
  return {
    readFileSync: vi.fn((_path: string, _enc: string) => {
      if (opts.pidFile === undefined) {
        const err = new Error("ENOENT");
        (err as NodeJS.ErrnoException).code = "ENOENT";
        throw err;
      }
      return opts.pidFile;
    }) as unknown as typeof import("node:fs").readFileSync,
    isAlive: (pid: number) => alive.has(pid),
  };
}

describe("inspectPidLock", () => {
  it("returns null when no pid file exists", () => {
    expect(inspectPidLock("/tmp/nope", 1234, deps())).toBeNull();
  });

  it("returns null when pid file contains our own pid", () => {
    expect(
      inspectPidLock("/tmp/pid", 1234, deps({ pidFile: "1234" })),
    ).toBeNull();
  });

  it("returns null when pid file content is malformed", () => {
    expect(
      inspectPidLock("/tmp/pid", 1234, deps({ pidFile: "not a pid" })),
    ).toBeNull();
  });

  it("returns null when recorded pid is no longer alive (stale file)", () => {
    expect(
      inspectPidLock(
        "/tmp/pid",
        1234,
        deps({ pidFile: "9999", alivePids: [] }),
      ),
    ).toBeNull();
  });

  it("returns the live conflicting pid when another daemon owns it", () => {
    expect(
      inspectPidLock(
        "/tmp/pid",
        1234,
        deps({ pidFile: "9999", alivePids: [9999] }),
      ),
    ).toBe(9999);
  });

  it("trims whitespace in the pid file", () => {
    expect(
      inspectPidLock(
        "/tmp/pid",
        1234,
        deps({ pidFile: "  9999\n", alivePids: [9999] }),
      ),
    ).toBe(9999);
  });
});
