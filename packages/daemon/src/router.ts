import type { MessageEnvelope } from "@lyy/shared";
import type { PaneInbox } from "./pane-inbox.js";
import type { PaneRegistry } from "./pane-registry.js";
import type { RelayClient } from "./relay-client.js";
import type { StateStore, ThreadSummary } from "./state.js";

export type { MessageEnvelope };

export interface RouterDeps {
  relay: RelayClient;
  paneRegistry: PaneRegistry;
  paneInbox: PaneInbox;
  state: StateStore;
  /** This daemon's own peerId — used to suppress unread bumps for own messages. */
  selfPeerId: string;
  /** Body preview length saved into state.json. */
  previewLen?: number;
  /** Invoked at the end of handleIncoming so subscribers (e.g. MCP IPC) can fan out. */
  onIncomingMessage?: (env: MessageEnvelope) => void;
}

const DEFAULT_PREVIEW_LEN = 80;

/**
 * Bridges relay events into local state + per-pane file inboxes.
 *
 * On incoming `message:new`:
 *   1. Always advance lastSeenSeq for that thread
 *   2. If sender is self → no unread bump, no inbox write
 *   3. Else if a thread pane is open locally → append to PaneInbox
 *      (pane's UserPromptSubmit hook drains on next user turn) and
 *      treat as already-read (no unread bump — pane will see it)
 *   4. Else → bump unread on the thread summary (statusLine picks up)
 *
 * Threads we have no local summary for are silently passed through;
 * the next /threads pull from the relay will rehydrate them.
 */
export class MessageRouter {
  private started = false;

  constructor(private readonly deps: RouterDeps) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.deps.relay.on("message:new", (env) => {
      void this.handleIncoming(env as MessageEnvelope);
    });
  }

  async handleIncoming(env: MessageEnvelope): Promise<void> {
    const { message, threadShortId } = env;
    const isFromSelf = message.fromPeer === this.deps.selfPeerId;
    const paneOpen =
      !isFromSelf && this.deps.paneRegistry.findPane(threadShortId) !== null;

    // Always accumulate in paneInbox unless we sent this ourselves. SessionStart
    // hook drains the file on /pickup so offline-accumulated messages surface.
    if (!isFromSelf) {
      await this.deps.paneInbox.append(threadShortId, message);
    }

    await this.deps.state.update((s) => {
      const lastSeenSeq = {
        ...s.lastSeenSeq,
        [message.threadId]: Math.max(
          s.lastSeenSeq[message.threadId] ?? 0,
          message.seq,
        ),
      };

      let threads = s.threads;
      const idx = threads.findIndex((t) => t.threadId === message.threadId);
      const previewLen = this.deps.previewLen ?? DEFAULT_PREVIEW_LEN;

      if (idx >= 0) {
        const existing = threads[idx];
        const updated: ThreadSummary = {
          ...existing,
          paneOpen,
          lastBody: message.body.slice(0, previewLen),
          lastMessageAt: message.sentAt,
          unread:
            isFromSelf || paneOpen ? existing.unread : existing.unread + 1,
        };
        threads = [...threads];
        threads[idx] = updated;
      } else if (env.thread && env.peers) {
        const otherId = env.thread.participants.find(
          (p) => p !== this.deps.selfPeerId,
        );
        const peerName = otherId
          ? (env.peers.find((p) => p.id === otherId)?.name ?? "?")
          : "?";
        threads = [
          ...threads,
          {
            threadId: env.thread.id,
            shortId: env.thread.shortId,
            peerName,
            lastBody: message.body.slice(0, previewLen),
            lastMessageAt: message.sentAt,
            unread: isFromSelf || paneOpen ? 0 : 1,
            archived: false,
            paneOpen,
          },
        ];
      } else {
        console.error(
          `[lyy-daemon] message:new for unknown thread ${message.threadId}; envelope missing thread/peers metadata (old relay?)`,
        );
      }

      const unreadCount = threads.reduce(
        (sum, t) => sum + (t.archived ? 0 : t.unread),
        0,
      );

      return { ...s, threads, lastSeenSeq, unreadCount };
    });

    this.deps.onIncomingMessage?.(env);
  }
}
