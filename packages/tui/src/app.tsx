import type { State } from "@lyy/daemon";
import { Box, Text } from "ink";
import React from "react";

export interface AppProps {
  initialState: State;
}

export function App({ initialState }: AppProps) {
  return (
    <Box flexDirection="column">
      <Text bold>LYY · 📬 {initialState.unreadCount} unread</Text>
      {initialState.threads.map((t) => (
        <Text key={t.threadId}>
          #{t.shortId} @{t.peerName} {t.lastBody}
        </Text>
      ))}
    </Box>
  );
}
