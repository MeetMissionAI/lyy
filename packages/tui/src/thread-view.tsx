import type { Message } from "@lyy/shared";
import { Box, Text } from "ink";
import React from "react";

export interface ThreadViewProps {
  thread: { threadId: string; shortId: number; peerName: string };
  messages: Message[];
  selfPeerId: string;
}

export function ThreadView({ thread, messages, selfPeerId }: ThreadViewProps) {
  return (
    <Box flexDirection="column">
      <Text bold>
        ← #{thread.shortId} @{thread.peerName}
      </Text>
      {messages.map((m) => {
        const who = m.fromPeer === selfPeerId ? "me" : thread.peerName;
        const time = m.sentAt.slice(11, 16);
        return (
          <Text key={m.id}>
            [{time}] {who}: {m.body}
          </Text>
        );
      })}
    </Box>
  );
}
