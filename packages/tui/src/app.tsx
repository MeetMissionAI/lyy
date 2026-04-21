import type { State } from "@lyy/daemon";
import type { Message } from "@lyy/shared";
import { Box, Text, useInput } from "ink";
import React, { useEffect, useState } from "react";
import { buildClaudePrompt, injectIntoClaudePane } from "./inject-claude.js";
import type { EventHandler } from "./ipc.js";
import { ThreadView } from "./thread-view.js";
import { useBlink } from "./use-blink.js";

type View = { kind: "list" } | { kind: "thread"; threadId: string };

export interface AppProps {
  initialState: State;
  fetchState?: () => Promise<State>;
  fetchMessages?: (threadId: string) => Promise<Message[]>;
  onSend?: (threadId: string, body: string) => Promise<void>;
  subscribeEvents?: (onEvent: EventHandler) => () => void;
  selfPeerId?: string;
}

export function App({
  initialState,
  fetchState = async () => initialState,
  fetchMessages = async () => [],
  onSend = async () => {},
  subscribeEvents = () => () => {},
  selfPeerId = "",
}: AppProps) {
  const [selected, setSelected] = useState(0);
  const [view, setView] = useState<View>({ kind: "list" });
  const [messages, setMessages] = useState<Message[]>([]);
  const [state, setState] = useState(initialState);
  const [version, setVersion] = useState(0);
  const [suggestion, setSuggestion] = useState<{
    threadId: string;
    body: string;
  } | null>(null);
  const threads = state.threads;
  const blink = useBlink(500);

  useInput((_input, key) => {
    if (view.kind === "list") {
      if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
      if (key.downArrow)
        setSelected((i) => Math.min(threads.length - 1, i + 1));
      if (key.return && threads[selected]) {
        setView({ kind: "thread", threadId: threads[selected].threadId });
      }
    } else if (view.kind === "thread") {
      if (key.escape) {
        // When a suggestion card is showing, Esc dismisses it instead of leaving.
        if (suggestion && suggestion.threadId === view.threadId) {
          setSuggestion(null);
          return;
        }
        setView({ kind: "list" });
        setMessages([]);
      }
    }
  });

  useEffect(() => {
    const unsub = subscribeEvents(async (event, payload) => {
      if (event === "message:new") {
        const fresh = await fetchState();
        setState(fresh);
        setVersion((v) => v + 1);
      } else if (event === "suggest_reply") {
        const p = payload as { threadId: string; body: string };
        setSuggestion(p);
      }
    });
    return unsub;
  }, [fetchState, subscribeEvents]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version bump triggers refetch on message:new
  useEffect(() => {
    if (view.kind === "thread") {
      void fetchMessages(view.threadId).then(setMessages);
    }
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
          // the visible transcript immediately. Daemon/router never echoes
          // self messages back (recipients = participants - sender), so we
          // won't see duplicates from subscribe push or refetch.
          const optimistic: Message = {
            id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            threadId: view.threadId,
            fromPeer: selfPeerId,
            body,
            sentAt: new Date().toISOString(),
            seq: 0,
          };
          setMessages((prev) => [...prev, optimistic]);
          await onSend(view.threadId, body);
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

  return (
    <Box flexDirection="column">
      <Text bold>LYY · 📬 {state.unreadCount} unread</Text>
      {threads.map((t, i) => {
        const marker = i === selected ? "▶ " : "  ";
        const isUnread = t.unread > 0 && !t.archived;
        const color = isUnread ? (blink ? "yellow" : "white") : undefined;
        return (
          <Text key={t.threadId} color={color}>
            {marker}#{t.shortId} @{t.peerName} {t.lastBody}
          </Text>
        );
      })}
    </Box>
  );
}
