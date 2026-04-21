import type { State } from "@lyy/daemon";
import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

export interface AppProps {
  initialState: State;
}

export function App({ initialState }: AppProps) {
  const [selected, setSelected] = useState(0);
  const threads = initialState.threads;

  useInput((_input, key) => {
    if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
    if (key.downArrow) setSelected((i) => Math.min(threads.length - 1, i + 1));
  });

  return (
    <Box flexDirection="column">
      <Text bold>LYY · 📬 {initialState.unreadCount} unread</Text>
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
