import { describe, expect, it } from "vitest";
import { buildClaudePrompt } from "./inject-claude.js";

describe("buildClaudePrompt", () => {
  it("packs history + question with self/peer labels and HH:MM time", () => {
    const prompt = buildClaudePrompt({
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
});
