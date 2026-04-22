import type { SendMessageResult, State } from "@lyy/daemon";
import { LYY_VERSION, type Message, type Peer } from "@lyy/shared";
import { Box, Text, useInput } from "ink";
import React, { useEffect, useState } from "react";
import { buildClaudePrompt, injectIntoClaudePane } from "./inject-claude.js";
import type { SubscribeCallbacks } from "./ipc.js";
import { ThreadView } from "./thread-view.js";
import { useBlink } from "./use-blink.js";

type View =
  | { kind: "list" }
  | { kind: "thread"; threadId: string }
  | { kind: "newThread"; peerName: string };

type Focus = "peers" | "threads";

export interface AppProps {
  initialState: State;
  initialPeers?: Peer[];
  fetchState?: () => Promise<State>;
  fetchPeers?: () => Promise<Peer[]>;
  fetchMessages?: (threadId: string) => Promise<Message[]>;
  onSend?: (
    threadId: string,
    body: string,
  ) => Promise<SendMessageResult | undefined>;
  onSendToPeer?: (peerName: string, body: string) => Promise<SendMessageResult>;
  /**
   * Fire-and-forget mark-thread-read on thread open. Daemon POSTs to relay
   * `/threads/:id/read` and zeroes the thread's unread in state.json so the
   * blinking-row UX stops immediately.
   */
  onAckThreadRead?: (threadId: string) => Promise<void>;
  subscribeEvents?: (callbacks: SubscribeCallbacks) => () => void;
  selfPeerId?: string;
}

export function App({
  initialState,
  initialPeers = [],
  fetchState = async () => initialState,
  fetchPeers,
  fetchMessages = async () => [],
  onSend = async () => undefined,
  onSendToPeer,
  onAckThreadRead,
  subscribeEvents = () => () => {},
  selfPeerId = "",
}: AppProps) {
  const [view, setView] = useState<View>({ kind: "list" });
  const [messages, setMessages] = useState<Message[]>([]);
  const [state, setState] = useState(initialState);
  const [peers, setPeers] = useState<Peer[]>(initialPeers);
  const [onlinePeers, setOnlinePeers] = useState<Set<string>>(new Set());
  const [daemonUp, setDaemonUp] = useState(true);
  const [relayConnected, setRelayConnected] = useState(false);
  const [focus, setFocus] = useState<Focus>("threads");
  const [peerSelected, setPeerSelected] = useState(0);
  const [threadSelected, setThreadSelected] = useState(0);
  const [version, setVersion] = useState(0);
  const [suggestion, setSuggestion] = useState<{
    threadId: string;
    body: string;
  } | null>(null);
  const threads = state.threads;
  // Exclude self from the peers column — can't open a thread with yourself.
  const otherPeers = peers.filter((p) => p.id !== selfPeerId);
  const blink = useBlink(500);

  useInput((_input, key) => {
    if (view.kind !== "list") {
      if (key.escape) {
        if (view.kind === "thread") {
          if (suggestion && suggestion.threadId === view.threadId) {
            setSuggestion(null);
            return;
          }
        }
        setView({ kind: "list" });
        setMessages([]);
      }
      return;
    }

    // List view: Tab toggles focus, ↑↓ moves within focused column, Enter opens.
    if (key.tab) {
      setFocus((f) => (f === "peers" ? "threads" : "peers"));
      return;
    }
    if (focus === "peers") {
      if (key.upArrow) setPeerSelected((i) => Math.max(0, i - 1));
      if (key.downArrow)
        setPeerSelected((i) => Math.min(otherPeers.length - 1, i + 1));
      if (key.return && otherPeers[peerSelected]) {
        const peer = otherPeers[peerSelected];
        const existing = threads.find(
          (t) => t.peerName === peer.name && !t.archived,
        );
        if (existing) {
          setView({ kind: "thread", threadId: existing.threadId });
        } else {
          setView({ kind: "newThread", peerName: peer.name });
        }
      }
      return;
    }
    // focus === "threads"
    if (key.upArrow) setThreadSelected((i) => Math.max(0, i - 1));
    if (key.downArrow)
      setThreadSelected((i) => Math.min(threads.length - 1, i + 1));
    if (key.return && threads[threadSelected]) {
      setView({ kind: "thread", threadId: threads[threadSelected].threadId });
    }
  });

  useEffect(() => {
    const unsub = subscribeEvents({
      onEvent: async (event, payload) => {
        if (event === "message:new") {
          const fresh = await fetchState();
          setState(fresh);
          setVersion((v) => v + 1);
        } else if (event === "suggest_reply") {
          const p = payload as { threadId: string; body: string };
          setSuggestion(p);
        } else if (event === "presence") {
          const p = payload as { online: string[] };
          setOnlinePeers(new Set(p.online));
        } else if (event === "relay:status") {
          const p = payload as { connected: boolean };
          setRelayConnected(p.connected);
        }
      },
      onDaemonUp: () => setDaemonUp(true),
      onDaemonDown: () => {
        setDaemonUp(false);
        setRelayConnected(false);
        setOnlinePeers(new Set());
      },
    });
    return unsub;
  }, [fetchState, subscribeEvents]);

  // Refresh peer list periodically so new teammates appear without a restart.
  useEffect(() => {
    if (!fetchPeers) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const fresh = await fetchPeers();
        if (!cancelled) setPeers(fresh);
      } catch {
        // ignore transient errors
      }
    };
    const id = setInterval(tick, 30_000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [fetchPeers]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version bump triggers refetch on message:new
  useEffect(() => {
    if (view.kind === "thread") {
      void fetchMessages(view.threadId).then(setMessages);
      // Fire-and-forget mark-read. Daemon zeroes the thread's unread in
      // state.json; we refetch so the row stops blinking immediately.
      if (onAckThreadRead) {
        const threadId = view.threadId;
        void onAckThreadRead(threadId)
          .then(() => fetchState())
          .then(setState)
          .catch(() => {
            // transient daemon/relay errors — next message:new will refetch.
          });
      }
    }
    // Note: don't setMessages([]) in the else branch — fetchMessages default
    // is re-created each render, so that would cause an infinite update loop.
    // Callers clear messages explicitly on view transitions (Esc, etc.).
  }, [view, fetchMessages, version]);

  if (view.kind === "thread") {
    const t = threads.find((x) => x.threadId === view.threadId);
    if (!t) return <Text>thread not found</Text>;
    return (
      <ThreadView
        thread={{
          threadId: t.threadId,
          shortId: t.shortId,
          peerName: t.peerName,
        }}
        messages={messages}
        selfPeerId={selfPeerId}
        onSend={async (body) => {
          // Optimistic insert: append locally first so the input clears into
          // the visible transcript immediately. Roll back + rethrow on failure
          // so ThreadView can restore the draft.
          const optimisticId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const optimistic: Message = {
            id: optimisticId,
            threadId: view.threadId,
            fromPeer: selfPeerId,
            body,
            sentAt: new Date().toISOString(),
            seq: 0,
          };
          setMessages((prev) => [...prev, optimistic]);
          try {
            await onSend(view.threadId, body);
          } catch (err) {
            setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
            throw err;
          }
        }}
        onInjectClaude={async (question) => {
          const prompt = buildClaudePrompt({
            threadId: t.threadId,
            threadShortId: t.shortId,
            peerName: t.peerName,
            history: messages,
            selfPeerId,
            question,
          });
          await injectIntoClaudePane(prompt);
        }}
        suggestion={
          suggestion && suggestion.threadId === view.threadId
            ? suggestion.body
            : undefined
        }
        onDismissSuggestion={() => setSuggestion(null)}
      />
    );
  }

  if (view.kind === "newThread") {
    const peerName = view.peerName;
    return (
      <ThreadView
        thread={{ threadId: "", shortId: 0, peerName }}
        messages={messages}
        selfPeerId={selfPeerId}
        onSend={async (body) => {
          if (!onSendToPeer) throw new Error("sendToPeer not configured");
          // Optimistic insert with a temp threadId — after the real send we
          // swap the view to the real thread so future sends take the normal
          // threadId path.
          const optimisticId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const optimistic: Message = {
            id: optimisticId,
            threadId: "",
            fromPeer: selfPeerId,
            body,
            sentAt: new Date().toISOString(),
            seq: 0,
          };
          setMessages((prev) => [...prev, optimistic]);
          try {
            const result = await onSendToPeer(peerName, body);
            const fresh = await fetchState();
            setState(fresh);
            setView({ kind: "thread", threadId: result.threadId });
          } catch (err) {
            setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
            throw err;
          }
        }}
      />
    );
  }

  // List view — two columns.
  const peerLines = otherPeers.map((p, i) => {
    const marker = focus === "peers" && i === peerSelected ? "▶ " : "  ";
    const color = focus === "peers" && i === peerSelected ? "cyan" : undefined;
    const online = onlinePeers.has(p.id);
    const dot = online ? "●" : "○";
    return (
      <Text key={p.id} color={color}>
        {marker}
        <Text color={online ? "green" : "gray"}>{dot}</Text> @{p.name}
        {p.displayName ? ` (${p.displayName})` : ""}
      </Text>
    );
  });
  const threadLines = threads.map((t, i) => {
    const selected = focus === "threads" && i === threadSelected;
    const marker = selected ? "▶ " : "  ";
    const isUnread = t.unread > 0 && !t.archived;
    const unreadColor = isUnread ? (blink ? "yellow" : "white") : undefined;
    const color = selected ? "cyan" : unreadColor;
    return (
      <Text key={t.threadId} color={color}>
        {marker}#{t.shortId} @{t.peerName} {t.lastBody}
      </Text>
    );
  });

  return (
    <Box flexDirection="column">
      <Text bold>LYY · 📬 {state.unreadCount} unread</Text>
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={focus === "peers" ? "cyan" : "gray"}
        paddingX={1}
      >
        <Text bold color={focus === "peers" ? "cyan" : undefined}>
          Peers
        </Text>
        {peerLines.length > 0 ? peerLines : <Text dimColor>(no peers)</Text>}
      </Box>
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={focus === "threads" ? "cyan" : "gray"}
        paddingX={1}
      >
        <Text bold color={focus === "threads" ? "cyan" : undefined}>
          Threads
        </Text>
        {threadLines.length > 0 ? (
          threadLines
        ) : (
          <Text dimColor>(no threads)</Text>
        )}
      </Box>
      <Text dimColor>[Tab] switch · [↑↓] move · [Enter] open · [Esc] back</Text>
      <Text dimColor>
        v{LYY_VERSION} · daemon{" "}
        <Text color={daemonUp ? "green" : "red"}>{daemonUp ? "●" : "○"}</Text>
        {" · "}relay{" "}
        <Text color={relayConnected ? "green" : "red"}>
          {relayConnected ? "●" : "○"}
        </Text>
      </Text>
    </Box>
  );
}
