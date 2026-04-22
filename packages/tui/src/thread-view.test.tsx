import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { ThreadView } from "./thread-view.js";

const messages = [
  {
    id: "m1",
    threadId: "t1",
    fromPeer: "11111111-1111-4111-8111-111111111aaa",
    body: "hi",
    sentAt: "2026-04-21T10:00:00Z",
    seq: 1,
  },
  {
    id: "m2",
    threadId: "t1",
    fromPeer: "22222222-2222-4222-8222-222222222bbb",
    body: "yo",
    sentAt: "2026-04-21T10:01:00Z",
    seq: 2,
  },
];

describe("ThreadView", () => {
  it("renders header with peerName + shortId", () => {
    const { lastFrame } = render(
      <ThreadView
        thread={{ threadId: "t1", shortId: 7, peerName: "alice" }}
        messages={messages}
        selfPeerId="22222222-2222-4222-8222-222222222bbb"
        onSend={() => {}}
      />,
    );
    expect(lastFrame()).toContain("#7");
    expect(lastFrame()).toContain("@alice");
  });

  it("labels messages from self as 'me' and others as peerName", () => {
    const { lastFrame } = render(
      <ThreadView
        thread={{ threadId: "t1", shortId: 7, peerName: "alice" }}
        messages={messages}
        selfPeerId="22222222-2222-4222-8222-222222222bbb"
        onSend={() => {}}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("alice");
    expect(frame).toContain("hi");
    expect(frame).toContain("me");
    expect(frame).toContain("yo");
  });

  it("shows HH:MM timestamp", () => {
    const { lastFrame } = render(
      <ThreadView
        thread={{ threadId: "t1", shortId: 7, peerName: "alice" }}
        messages={messages}
        selfPeerId="22222222-2222-4222-8222-222222222bbb"
        onSend={() => {}}
      />,
    );
    expect(lastFrame()).toContain("10:00");
    expect(lastFrame()).toContain("10:01");
  });

  it("shows loading indicator when isLoading=true", () => {
    const { lastFrame } = render(
      <ThreadView
        thread={{ threadId: "t1", shortId: 7, peerName: "alice" }}
        messages={[]}
        selfPeerId="self"
        isLoading
        onSend={() => {}}
      />,
    );
    expect(lastFrame()).toContain("Loading messages");
  });

  it("renders empty history without crashing", () => {
    const { lastFrame } = render(
      <ThreadView
        thread={{ threadId: "t1", shortId: 7, peerName: "alice" }}
        messages={[]}
        selfPeerId="self"
        onSend={() => {}}
      />,
    );
    expect(lastFrame()).toContain("#7");
  });

  it("typing + Enter calls onSend with trimmed body", async () => {
    const onSend = vi.fn(async () => {});
    const { stdin } = render(
      <ThreadView
        thread={{ threadId: "t1", shortId: 7, peerName: "alice" }}
        messages={[]}
        selfPeerId="peer-self"
        onSend={onSend}
      />,
    );
    await new Promise((r) => setTimeout(r, 10));
    stdin.write("hi");
    await new Promise((r) => setTimeout(r, 30));
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 30));
    expect(onSend).toHaveBeenCalledWith("hi");
  });

  it("@Claude prefix routes to onInjectClaude, not onSend", async () => {
    const onSend = vi.fn(async () => {});
    const onInjectClaude = vi.fn(async () => {});
    const { stdin } = render(
      <ThreadView
        thread={{ threadId: "t1", shortId: 7, peerName: "alice" }}
        messages={[]}
        selfPeerId="peer-self"
        onSend={onSend}
        onInjectClaude={onInjectClaude}
      />,
    );
    await new Promise((r) => setTimeout(r, 10));
    stdin.write("@Claude help");
    await new Promise((r) => setTimeout(r, 30));
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 30));
    expect(onInjectClaude).toHaveBeenCalledWith("help");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("draft preserved if onInjectClaude throws", async () => {
    const onSend = vi.fn(async () => {});
    const onInjectClaude = vi.fn(async () => {
      throw new Error("zellij missing");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { stdin, lastFrame } = render(
      <ThreadView
        thread={{ threadId: "t1", shortId: 7, peerName: "alice" }}
        messages={[]}
        selfPeerId="peer-self"
        onSend={onSend}
        onInjectClaude={onInjectClaude}
      />,
    );
    await new Promise((r) => setTimeout(r, 10));
    stdin.write("@Claude help");
    await new Promise((r) => setTimeout(r, 30));
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 30));
    expect(onInjectClaude).toHaveBeenCalled();
    // TextInput should still show "@Claude help"
    expect(lastFrame()).toContain("@Claude help");
    errorSpy.mockRestore();
  });

  it("empty input does not trigger onSend", async () => {
    const onSend = vi.fn(async () => {});
    const { stdin } = render(
      <ThreadView
        thread={{ threadId: "t1", shortId: 7, peerName: "alice" }}
        messages={[]}
        selfPeerId="peer-self"
        onSend={onSend}
      />,
    );
    await new Promise((r) => setTimeout(r, 10));
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 30));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("renders suggestion card when suggestion prop provided", () => {
    const { lastFrame } = render(
      <ThreadView
        thread={{ threadId: "t1", shortId: 7, peerName: "alice" }}
        messages={[]}
        selfPeerId="peer-self"
        onSend={async () => {}}
        suggestion="How about dinner tonight?"
        onDismissSuggestion={() => {}}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("💡 Claude: How about dinner tonight?");
    expect(frame).toContain("Tab: accept");
  });

  it("Tab on suggestion card accepts into input + dismisses", async () => {
    const onDismiss = vi.fn();
    const { stdin, lastFrame } = render(
      <ThreadView
        thread={{ threadId: "t1", shortId: 7, peerName: "alice" }}
        messages={[]}
        selfPeerId="peer-self"
        onSend={async () => {}}
        suggestion="yes!"
        onDismissSuggestion={onDismiss}
      />,
    );
    await new Promise((r) => setTimeout(r, 10));
    stdin.write("\t"); // Tab
    await new Promise((r) => setTimeout(r, 30));
    expect(onDismiss).toHaveBeenCalled();
    // draft should now contain "yes!"
    expect(lastFrame()).toContain("yes!");
  });
});
