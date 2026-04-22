import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  compareVersion,
  fetchLatestTag,
  isDevInstall,
  parseVersion,
} from "./upgrade.js";

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

describe("fetchLatestTag", () => {
  const repo = "org/repo";

  function mockFetch(impl: (url: string, init: RequestInit) => Response) {
    const spy = vi.fn(async (url, init) => impl(String(url), init ?? {}));
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  afterEach(() => vi.unstubAllGlobals());

  it("returns {tag, etag} on 200", async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ tag_name: "v0.2.7" }), {
          status: 200,
          headers: { etag: 'W/"abc"' },
        }),
    );
    expect(await fetchLatestTag(repo, null)).toEqual({
      tag: "v0.2.7",
      etag: 'W/"abc"',
    });
  });

  it("returns {null, prevEtag} on 304", async () => {
    mockFetch(() => new Response(null, { status: 304 }));
    expect(await fetchLatestTag(repo, 'W/"abc"')).toEqual({
      tag: null,
      etag: 'W/"abc"',
    });
  });

  it("returns {null, null} on error / timeout / bad body", async () => {
    mockFetch(() => new Response("not json", { status: 200 }));
    expect(await fetchLatestTag(repo, null)).toEqual({ tag: null, etag: null });
  });

  it("sends If-None-Match when prevEtag is provided", async () => {
    const spy = mockFetch(() => new Response(null, { status: 304 }));
    await fetchLatestTag(repo, 'W/"xyz"');
    const init = spy.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["if-none-match"]).toBe('W/"xyz"');
  });
});

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEtag, writeEtag } from "./upgrade.js";

describe("etag cache", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lyy-upgrade-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads null when file missing", () => {
    expect(readEtag(join(dir, "etag"))).toBeNull();
  });

  it("round-trips through write/read", () => {
    const path = join(dir, "etag");
    writeEtag(path, 'W/"abc"');
    expect(readEtag(path)).toBe('W/"abc"');
  });

  it("trims trailing whitespace/newlines", () => {
    const path = join(dir, "etag");
    writeFileSync(path, 'W/"abc"\n\n', "utf8");
    expect(readEtag(path)).toBe('W/"abc"');
  });
});

import { createHash } from "node:crypto";
import { parseSha256Manifest, verifySha256 } from "./upgrade.js";

describe("parseSha256Manifest", () => {
  it("parses `<hex>  <filename>` lines", () => {
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    const c = "c".repeat(64);
    const manifest = [
      `${a}  lyy-cli.tgz`,
      `${b}  lyy-daemon.tgz`,
      "",
      `${c}  lyy-mcp.tgz`,
    ].join("\n");
    expect(parseSha256Manifest(manifest)).toEqual(
      new Map([
        ["lyy-cli.tgz", a],
        ["lyy-daemon.tgz", b],
        ["lyy-mcp.tgz", c],
      ]),
    );
  });
});

describe("verifySha256", () => {
  it("accepts matching hash", () => {
    const buf = Buffer.from("hello");
    const hex = createHash("sha256").update(buf).digest("hex");
    expect(verifySha256(buf, hex)).toBe(true);
  });
  it("rejects mismatch", () => {
    expect(verifySha256(Buffer.from("hello"), "0".repeat(64))).toBe(false);
  });
});

import { swapRuntime } from "./upgrade.js";

describe("swapRuntime", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lyy-swap-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("promotes staging → runtime, deletes old", () => {
    const runtime = join(dir, "runtime");
    const staging = join(dir, "runtime-staging");
    mkdirSync(runtime);
    writeFileSync(join(runtime, "VERSION"), "v0.0.1");
    mkdirSync(staging);
    writeFileSync(join(staging, "VERSION"), "v0.0.2");

    swapRuntime(staging, runtime);

    expect(readFileSync(join(runtime, "VERSION"), "utf8")).toBe("v0.0.2");
    expect(existsSync(staging)).toBe(false);
    expect(existsSync(`${runtime}-old`)).toBe(false);
  });

  it("works when runtime doesn't exist yet", () => {
    const runtime = join(dir, "runtime");
    const staging = join(dir, "runtime-staging");
    mkdirSync(staging);
    writeFileSync(join(staging, "VERSION"), "v0.0.2");

    swapRuntime(staging, runtime);

    expect(readFileSync(join(runtime, "VERSION"), "utf8")).toBe("v0.0.2");
  });
});
