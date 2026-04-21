import type { State } from "@lyy/daemon";
import type { Message } from "@lyy/shared";
import { Box, Text, useInput } from "ink";
import React, { useEffect, useState } from "react";
import type { EventHandler } from "./ipc.js";
import { ThreadView } from "./thread-view.js";

type View = { kind: "list" } | { kind: "thread"; threadId: string };

export interface AppProps {
  initialState: State;
  fetchState?: () => Promise<State>;
  fetchMessages?: (threadId: string) => Promise<Message[]>;
  subscribeEvents?: (onEvent: EventHandler) => () => void;
  selfPeerId?: string;
}

export function App({
  initialState,
  fetchState = async () => initialState,
  fetchMessages = async () => [],
  subscribeEvents = () => () => {},
  selfPeerId = "",
}: AppProps) {
  const [selected, setSelected] = useState(0);
  const [view, setView] = useState<View>({ kind: "list" });
  const [messages, setMessages] = useState<Message[]>([]);
  const [state, setState] = useState(initialState);
  const [version, setVersion] = useState(0);
  const threads = state.threads;

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
        setView({ kind: "list" });
        setMessages([]);
      }
    }
  });

  useEffect(() => {
    const unsub = subscribeEvents(async (event) => {
      if (event === "message:new") {
        const fresh = await fetchState();
        setState(fresh);
        setVersion((v) => v + 1);
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
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>LYY · 📬 {state.unreadCount} unread</Text>
      {threads.map((t, i) => {
        const marker = i === selected ? "▶ " : "  ";
        return (
          <Text key={t.threadId}>
            {marker}#{t.shortId} @{t.peerName} {t.lastBody}
          </Text>
        );
      })}
    </Box>
  );
}
