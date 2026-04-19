import type { Message } from "@lyy/shared";

export interface RelayHttpDeps {
  baseUrl: string;
  jwt: string;
  fetchImpl?: typeof fetch;
}

export interface SendMessageInput {
  toPeer?: string;
  threadId?: string;
  body: string;
  forceNew?: boolean;
}

export interface SendMessageResult {
  messageId: string;
  threadId: string;
  threadShortId: number;
  seq: number;
  sentAt: string;
}

export interface InboxThreadShape {
  threadId: string;
  shortId: number;
  title: string | null;
  participants: string[];
  lastMessageAt: string;
  archived: boolean;
  unread: number;
}

export interface InboxResponse {
  unreadCount: number;
  threads: InboxThreadShape[];
}

/** Thin typed HTTP client to the relay; auth via Bearer JWT. */
export class RelayHttp {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly deps: RelayHttpDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  private url(path: string): string {
    return `${this.deps.baseUrl.replace(/\/$/, "")}${path}`;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.deps.jwt}`,
      "content-type": "application/json",
    };
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const res = await this.fetchImpl(this.url("/messages"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(input),
    });
    if (!res.ok)
      throw new Error(
        `POST /messages failed: ${res.status} ${await res.text()}`,
      );
    return (await res.json()) as SendMessageResult;
  }

  async markRead(messageIds: string[]): Promise<void> {
    const res = await this.fetchImpl(this.url("/reads"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ messageIds }),
    });
    if (!res.ok) throw new Error(`POST /reads failed: ${res.status}`);
  }

  async archiveThread(threadId: string): Promise<void> {
    const res = await this.fetchImpl(this.url(`/threads/${threadId}/archive`), {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok)
      throw new Error(`POST /threads/:id/archive failed: ${res.status}`);
  }

  async unarchiveThread(threadId: string): Promise<void> {
    const res = await this.fetchImpl(this.url(`/threads/${threadId}/archive`), {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok)
      throw new Error(`DELETE /threads/:id/archive failed: ${res.status}`);
  }

  async listThreads(includeArchived = false): Promise<InboxResponse> {
    const qs = includeArchived ? "?includeArchived=true" : "";
    const res = await this.fetchImpl(this.url(`/threads${qs}`), {
      method: "GET",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`GET /threads failed: ${res.status}`);
    return (await res.json()) as InboxResponse;
  }

  async readThread(
    threadId: string,
    sinceSeq?: number,
  ): Promise<{ messages: Message[] }> {
    const qs = sinceSeq != null ? `&sinceSeq=${sinceSeq}` : "";
    const res = await this.fetchImpl(
      this.url(`/messages?threadId=${threadId}${qs}`),
      {
        method: "GET",
        headers: this.headers(),
      },
    );
    if (!res.ok) throw new Error(`GET /messages failed: ${res.status}`);
    return (await res.json()) as { messages: Message[] };
  }

  async search(q: string, limit = 50): Promise<{ messages: Message[] }> {
    const res = await this.fetchImpl(
      this.url(`/search?q=${encodeURIComponent(q)}&limit=${limit}`),
      { method: "GET", headers: this.headers() },
    );
    if (!res.ok) throw new Error(`GET /search failed: ${res.status}`);
    return (await res.json()) as { messages: Message[] };
  }
}
