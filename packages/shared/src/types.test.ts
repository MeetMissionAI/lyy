import { describe, it, expect } from "vitest";
import type { Attachment, InboxSummary, Message, Peer, Thread } from "./types.js";

describe("shared types", () => {
  it("Peer has required fields", () => {
    const p: Peer = {
      id: "uuid-1",
      name: "leo",
      email: "leo@missionai.com",
      displayName: "Leo",
      createdAt: new Date().toISOString(),
    };
    expect(p.name).toBe("leo");
  });

  it("Thread has shortId for display", () => {
    const t: Thread = {
      id: "uuid-t1",
      shortId: 42,
      title: "Lottie animation question",
      createdAt: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
      participants: ["uuid-jianfeng", "uuid-leo"],
    };
    expect(t.shortId).toBe(42);
  });

  it("Message has thread + seq ordering fields", () => {
    const m: Message = {
      id: "uuid-m1",
      threadId: "uuid-t1",
      fromPeer: "uuid-1",
      body: "hello",
      sentAt: new Date().toISOString(),
      seq: 1,
    };
    expect(m.seq).toBe(1);
  });

  it("Message can carry attachments", () => {
    const a: Attachment = {
      id: "uuid-a1",
      messageId: "uuid-m1",
      storagePath: "blobs/uuid-a1.png",
      mime: "image/png",
      size: 1024,
    };
    const m: Message = {
      id: "uuid-m1",
      threadId: "uuid-t1",
      fromPeer: "uuid-1",
      body: "see image",
      sentAt: new Date().toISOString(),
      seq: 2,
      attachments: [a],
    };
    expect(m.attachments?.[0].mime).toBe("image/png");
  });

  it("InboxSummary aggregates thread state for statusLine", () => {
    const inbox: InboxSummary = {
      unreadCount: 1,
      threads: [
        {
          threadId: "uuid-t1",
          shortId: 12,
          peerName: "jianfeng",
          lastBody: "能不能做 X?",
          unread: 1,
          lastMessageAt: new Date().toISOString(),
          archived: false,
        },
      ],
    };
    expect(inbox.threads[0].shortId).toBe(12);
    expect(inbox.unreadCount).toBe(1);
  });
});
