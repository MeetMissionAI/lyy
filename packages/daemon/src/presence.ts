import type { RelayClient } from "./relay-client.js";

/**
 * Mirrors the relay's presence set locally. Seeded by `presence:snapshot`
 * on (re)connect, patched by `presence:change` deltas. Consumers read via
 * `get()` / `has()`; subscribers get `change` events forwarded upstream
 * (e.g. to TUI via McpIpc).
 */
export class PresenceStore {
  private online = new Set<string>();
  private listeners = new Set<(peers: string[]) => void>();

  attach(relay: RelayClient): void {
    relay.on("presence:snapshot", (payload) => {
      const { online } = payload as { online: string[] };
      this.online = new Set(online);
      this.notify();
    });
    relay.on("presence:change", (payload) => {
      const { peerId, online } = payload as {
        peerId: string;
        online: boolean;
      };
      if (online) this.online.add(peerId);
      else this.online.delete(peerId);
      this.notify();
    });
    relay.on("disconnected", () => {
      // Can't trust our view once the socket drops; clear so the UI doesn't
      // show stale-online peers. Re-seeded on next snapshot.
      if (this.online.size === 0) return;
      this.online.clear();
      this.notify();
    });
  }

  get(): string[] {
    return [...this.online];
  }

  has(peerId: string): boolean {
    return this.online.has(peerId);
  }

  onChange(fn: (peers: string[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    const snapshot = this.get();
    for (const fn of this.listeners) fn(snapshot);
  }
}
