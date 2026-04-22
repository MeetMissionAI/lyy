import type { Message } from "@lyy/shared";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import React, { useState } from "react";
import { parseClaudeMention } from "./inject-claude.js";
import { TextArea } from "./text-area.js";

export interface ThreadViewProps {
  thread: { threadId: string; shortId: number; peerName: string };
  messages: Message[];
  selfPeerId: string;
  isLoading?: boolean;
  onSend: (body: string) => Promise<void> | void;
  onInjectClaude?: (question: string) => Promise<void> | void;
  suggestion?: string;
  onDismissSuggestion?: () => void;
}

export function ThreadView({
  thread,
  messages,
  selfPeerId,
  isLoading,
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
    // Clear immediately for responsive feel; app.tsx optimistic-inserts the
    // message so it's visible before the network round-trip completes.
    setDraft("");
    try {
      const mention = parseClaudeMention(body);
      if (mention && onInjectClaude) {
        await onInjectClaude(mention.question);
      } else {
        await onSend(body);
      }
    } catch (err) {
      // Restore draft so user can retry.
      setDraft(value);
      console.error("[lyy-tui] send/inject failed:", err);
    }
  };

  return (
    <Box flexDirection="column">
      <Text bold>
        ← #{thread.shortId} @{thread.peerName}
      </Text>
      <Box flexDirection="column" flexGrow={1}>
        {isLoading ? (
          <Box marginTop={1}>
            <Text color="cyan">
              <Spinner type="dots" />
            </Text>
            <Text dimColor> Loading messages…</Text>
          </Box>
        ) : (
          messages.map((m) => {
            const isSelf = m.fromPeer === selfPeerId;
            const who = isSelf ? "me" : thread.peerName;
            const time = m.sentAt.slice(11, 16);
            return (
              <Box key={m.id} flexDirection="column" marginTop={1}>
                <Text>
                  <Text dimColor>{time} </Text>
                  <Text bold color={isSelf ? "cyan" : undefined}>
                    {who}
                  </Text>
                </Text>
                <Text>{m.body}</Text>
              </Box>
            );
          })
        )}
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
        <Box flexGrow={1} flexDirection="column" height={2}>
          <TextArea
            value={draft}
            onChange={setDraft}
            onSubmit={handleSubmit}
            placeholder={String.raw`type message, \ + Enter newline, @Claude or @CC for help`}
            isActive={!suggestion}
          />
        </Box>
      </Box>
    </Box>
  );
}
