import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadIdentity } from "./identity.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lyy-identity-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeIdentity(content: string): string {
  const p = join(dir, "identity.json");
  writeFileSync(p, content);
  return p;
}

describe("loadIdentity", () => {
  it("loads valid identity", () => {
    const p = writeIdentity(
      JSON.stringify({
        peerId: "550e8400-e29b-41d4-a716-446655440000",
        jwt: "eyJhbG.test.token",
        relayUrl: "https://relay.example.com",
      }),
    );
    const id = loadIdentity(p);
    expect(id.peerId).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(id.jwt).toBe("eyJhbG.test.token");
    expect(id.relayUrl).toBe("https://relay.example.com");
  });

  it("throws on missing file", () => {
    expect(() => loadIdentity(join(dir, "nope.json"))).toThrow();
  });

  it("throws on bad JSON", () => {
    const p = writeIdentity("{not json");
    expect(() => loadIdentity(p)).toThrow();
  });

  it("throws when peerId is not a UUID", () => {
    const p = writeIdentity(
      JSON.stringify({
        peerId: "not-uuid",
        jwt: "x",
        relayUrl: "https://x.com",
      }),
    );
    expect(() => loadIdentity(p)).toThrow(/Invalid identity/);
  });

  it("throws when relayUrl is not a URL", () => {
    const p = writeIdentity(
      JSON.stringify({
        peerId: "550e8400-e29b-41d4-a716-446655440000",
        jwt: "x",
        relayUrl: "not a url",
      }),
    );
    expect(() => loadIdentity(p)).toThrow();
  });

  it("throws when jwt is empty", () => {
    const p = writeIdentity(
      JSON.stringify({
        peerId: "550e8400-e29b-41d4-a716-446655440000",
        jwt: "",
        relayUrl: "https://x.com",
      }),
    );
    expect(() => loadIdentity(p)).toThrow();
  });
});
