import type { Message } from "@lyy/shared";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import React, { useState } from "react";

export interface ThreadViewProps {
  thread: { threadId: string; shortId: number; peerName: string };
  messages: Message[];
  selfPeerId: string;
  onSend: (body: string) => Promise<void> | void;
  onInjectClaude?: (question: string) => Promise<void> | void;
}

export function ThreadView({
  thread,
  messages,
  selfPeerId,
  onSend,
  onInjectClaude,
}: ThreadViewProps) {
  const [draft, setDraft] = useState("");

  const handleSubmit = async (value: string) => {
    const body = value.trim();
    if (!body) return;
    setDraft("");
    if (body.startsWith("@Claude ") && onInjectClaude) {
      const question = body.slice("@Claude ".length);
      await onInjectClaude(question);
      return;
    }
    await onSend(body);
  };

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
      <Box marginTop={1}>
        <Text>&gt; </Text>
        <TextInput value={draft} onChange={setDraft} onSubmit={handleSubmit} />
      </Box>
    </Box>
  );
}
