import type { PaneInbox } from "./pane-inbox.js";
import type { RelayHttp } from "./relay-http.js";
import type { StateStore, ThreadSummary } from "./state.js";

export interface SyncDeps {
  relayHttp: RelayHttp;
  state: StateStore;
  paneInbox: PaneInbox;
  selfPeerId: string;
}

/**
 * Pull authoritative inbox state from the relay and reconcile with local state.
 * Called on daemon (re)connect. Missed messages for threads with unread > 0
 * are backfilled into paneInbox so /pickup sees them on next open.
 */
export async function syncStateFromRelay(deps: SyncDeps): Promise<void> {
  const [threadsRes, peersRes, prevState] = await Promise.all([
    deps.relayHttp.listThreads(true),
    deps.relayHttp.listPeers(),
    deps.state.read(),
  ]);

  const peerById = new Map(peersRes.peers.map((p) => [p.id, p]));

  // Backfill messages for threads with unread > 0.
  const backfillSeq: Record<string, number> = {};
  for (const t of threadsRes.threads) {
    if (t.unread <= 0) continue;
    const sinceSeq = prevState.lastSeenSeq[t.threadId] ?? 0;
    const { messages } = await deps.relayHttp.readThread(t.threadId, sinceSeq);
    let maxSeq = sinceSeq;
    for (const m of messages) {
      maxSeq = Math.max(maxSeq, m.seq);
      if (m.fromPeer === deps.selfPeerId) continue;
      await deps.paneInbox.append(t.shortId, m);
    }
    backfillSeq[t.threadId] = maxSeq;
  }

  // Build merged thread summaries. Relay is source of truth for unread/lastMessageAt/archived.
  // Preserve paneOpen + lastBody from local state (local-only fields).
  const existingByThread = new Map(
    prevState.threads.map((t) => [t.threadId, t]),
  );
  const merged: ThreadSummary[] = threadsRes.threads.map((t) => {
    const existing = existingByThread.get(t.threadId);
    const otherId = t.participants.find((p) => p !== deps.selfPeerId);
    const peerName = otherId ? (peerById.get(otherId)?.name ?? "?") : "?";
    return {
      threadId: t.threadId,
      shortId: t.shortId,
      peerName,
      lastBody: existing?.lastBody ?? "",
      lastMessageAt: t.lastMessageAt,
      unread: t.unread,
      archived: t.archived,
      paneOpen: existing?.paneOpen ?? false,
    };
  });

  const unreadCount = merged.reduce(
    (sum, t) => sum + (t.archived ? 0 : t.unread),
    0,
  );

  await deps.state.update((s) => ({
    ...s,
    threads: merged,
    unreadCount,
    lastSeenSeq: { ...s.lastSeenSeq, ...backfillSeq },
  }));
}
