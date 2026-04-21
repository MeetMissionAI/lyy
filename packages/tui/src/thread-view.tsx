import type { Message } from "@lyy/shared";
import { Box, Text, useInput } from "ink";
import React, { useState } from "react";
import { TextArea } from "./text-area.js";

export interface ThreadViewProps {
  thread: { threadId: string; shortId: number; peerName: string };
  messages: Message[];
  selfPeerId: string;
  onSend: (body: string) => Promise<void> | void;
  onInjectClaude?: (question: string) => Promise<void> | void;
  suggestion?: string;
  onDismissSuggestion?: () => void;
}

export function ThreadView({
  thread,
  messages,
  selfPeerId,
  onSend,
  onInjectClaude,
  suggestion,
  onDismissSuggestion,
}: ThreadViewProps) {
  const [draft, setDraft] = useState("");

  useInput(
    (_input, key) => {
      if (!suggestion) return;
      if (key.tab) {
        setDraft(suggestion);
        onDismissSuggestion?.();
      } else if (key.escape) {
        onDismissSuggestion?.();
      }
    },
    { isActive: Boolean(suggestion) },
  );

  const handleSubmit = async (value: string) => {
    const body = value.trim();
    if (!body) return;
    try {
      if (body.startsWith("@Claude ") && onInjectClaude) {
        const question = body.slice("@Claude ".length);
        await onInjectClaude(question);
      } else {
        await onSend(body);
      }
      setDraft("");
    } catch (err) {
      // Keep draft so user can retry; surface error on stderr for debugging.
      console.error("[lyy-tui] send/inject failed:", err);
    }
  };

  return (
    <Box flexDirection="column">
      <Text bold>
        ← #{thread.shortId} @{thread.peerName}
      </Text>
      <Box flexDirection="column" flexGrow={1}>
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
      {suggestion && (
        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="round"
          borderColor="cyan"
          paddingX={1}
        >
          <Text color="cyan">💡 Claude: {suggestion}</Text>
          <Text dimColor>[Tab: accept · Esc: dismiss]</Text>
        </Box>
      )}
      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="cyan">&gt; </Text>
        <Box flexGrow={1} flexDirection="column">
          <TextArea
            value={draft}
            onChange={setDraft}
            onSubmit={handleSubmit}
            placeholder="type message, Shift+Tab newline, @Claude for help"
            isActive={!suggestion}
          />
        </Box>
      </Box>
    </Box>
  );
}
