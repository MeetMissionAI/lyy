import type { Message } from "@lyy/shared";
import type { PaneInbox } from "./pane-inbox.js";
import type { PaneRegistry } from "./pane-registry.js";
import type { RelayClient } from "./relay-client.js";
import type { StateStore, ThreadSummary } from "./state.js";

// NOTE: keep in sync with packages/relay/src/server.ts EnvelopePeer/Thread/MessageEnvelope
export interface EnvelopePeer {
  id: string;
  name: string;
  displayName?: string;
}

export interface EnvelopeThread {
  id: string;
  shortId: number;
  title: string | null;
  participants: string[];
}

export interface MessageEnvelope {
  message: Message;
  threadShortId: number; // backward compat — keep
  thread?: EnvelopeThread;
  peers?: EnvelopePeer[];
}

export interface RouterDeps {
  relay: RelayClient;
  paneRegistry: PaneRegistry;
  paneInbox: PaneInbox;
  state: StateStore;
  /** This daemon's own peerId — used to suppress unread bumps for own messages. */
  selfPeerId: string;
  /** Body preview length saved into state.json. */
  previewLen?: number;
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

    if (paneOpen) {
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
      if (idx >= 0) {
        const existing = threads[idx];
        const updated: ThreadSummary = {
          ...existing,
          paneOpen,
          lastBody: message.body.slice(
            0,
            this.deps.previewLen ?? DEFAULT_PREVIEW_LEN,
          ),
          lastMessageAt: message.sentAt,
          unread:
            isFromSelf || paneOpen ? existing.unread : existing.unread + 1,
        };
        threads = [...threads];
        threads[idx] = updated;
      }
      // No-summary case: leave threads alone; daemon's /threads sync rehydrates later

      const unreadCount = threads.reduce(
        (sum, t) => sum + (t.archived ? 0 : t.unread),
        0,
      );

      return { ...s, threads, lastSeenSeq, unreadCount };
    });
  }
}
