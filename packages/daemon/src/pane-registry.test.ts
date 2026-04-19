import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PaneRegistry, PaneRegistryClient } from "./pane-registry.js";

let dir: string;
let registry: PaneRegistry;
let client: PaneRegistryClient;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "lyy-paneregistry-"));
  const sock = join(dir, "reg.sock");
  registry = new PaneRegistry(sock);
  await registry.start();
  client = new PaneRegistryClient(sock);
});
afterEach(async () => {
  await registry.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe("PaneRegistry", () => {
  it("registers + queries a pane", async () => {
    await client.register(12, "zellij-pane-abc");
    expect(await client.query(12)).toBe("zellij-pane-abc");
    expect(registry.findPane(12)).toBe("zellij-pane-abc");
  });

  it("returns null for unknown thread", async () => {
    expect(await client.query(999)).toBeNull();
  });

  it("unregister removes the entry", async () => {
    await client.register(7, "p1");
    await client.unregister(7);
    expect(await client.query(7)).toBeNull();
    expect(registry.size()).toBe(0);
  });

  it("re-register overwrites previous paneId", async () => {
    await client.register(3, "p1");
    await client.register(3, "p2");
    expect(await client.query(3)).toBe("p2");
  });

  it("server cleans up its socket file on stop", async () => {
    const fs = await import("node:fs");
    expect(fs.existsSync((registry as unknown as { sockPath: string }).sockPath)).toBe(true);
    await registry.stop();
    expect(fs.existsSync((registry as unknown as { sockPath: string }).sockPath)).toBe(false);
    // Re-start for afterEach to not double-stop
    await registry.start();
  });

  it("handles concurrent client requests independently", async () => {
    await Promise.all([
      client.register(100, "a"),
      client.register(101, "b"),
      client.register(102, "c"),
    ]);
    expect(await client.query(100)).toBe("a");
    expect(await client.query(101)).toBe("b");
    expect(await client.query(102)).toBe("c");
    expect(registry.size()).toBe(3);
  });
});
