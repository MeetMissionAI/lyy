import { describe, expect, it } from "vitest";
import { buildClaudePrompt } from "./inject-claude.js";

describe("buildClaudePrompt", () => {
  const tid = "5498d1b4-18ab-4efd-88bd-9740072c926c";

  it("packs history + question with self/peer labels and HH:MM time", () => {
    const prompt = buildClaudePrompt({
      threadId: tid,
      threadShortId: 7,
      peerName: "alice",
      history: [
        {
          sentAt: "2026-04-21T10:00:00Z",
          fromPeer: "peer-alice",
          body: "hi",
        },
        {
          sentAt: "2026-04-21T10:05:00Z",
          fromPeer: "peer-self",
          body: "yo",
        },
      ],
      selfPeerId: "peer-self",
      question: "how should I reply formally?",
    });
    expect(prompt).toContain("LYY thread #7 with @alice");
    expect(prompt).toContain("[2026-04-21 10:00] alice: hi");
    expect(prompt).toContain("[2026-04-21 10:05] me: yo");
    expect(prompt).toContain("My question: how should I reply formally?");
  });

  it("handles empty history", () => {
    const prompt = buildClaudePrompt({
      threadId: tid,
      threadShortId: 7,
      peerName: "alice",
      history: [],
      selfPeerId: "peer-self",
      question: "start conversation",
    });
    expect(prompt).toContain("LYY thread #7 with @alice");
    expect(prompt).toContain("History:");
    expect(prompt).toContain("My question: start conversation");
  });

  it("includes threadId UUID + suggest_reply instruction", () => {
    const prompt = buildClaudePrompt({
      threadId: tid,
      threadShortId: 7,
      peerName: "alice",
      history: [],
      selfPeerId: "peer-self",
      question: "hi",
    });
    expect(prompt).toContain(`thread_id="${tid}"`);
    expect(prompt).toContain("lyy.suggest_reply");
  });
});
