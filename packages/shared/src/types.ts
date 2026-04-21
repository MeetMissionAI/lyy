export interface Peer {
  id: string;
  name: string;
  email: string;
  displayName?: string;
  createdAt: string;
}

export interface Thread {
  id: string;
  shortId: number;
  title?: string;
  createdAt: string;
  lastMessageAt: string;
  participants: string[];
}

export interface Message {
  id: string;
  threadId: string;
  fromPeer: string;
  body: string;
  sentAt: string;
  seq: number;
  attachments?: Attachment[];
}

export interface Attachment {
  id: string;
  messageId: string;
  storagePath: string;
  mime: string;
  size: number;
}

export interface InboxThreadSummary {
  threadId: string;
  shortId: number;
  peerName: string;
  lastBody: string;
  unread: number;
  lastMessageAt: string;
  archived: boolean;
}

export interface InboxSummary {
  unreadCount: number;
  threads: InboxThreadSummary[];
}

export interface EnvelopePeer {
  id: string;
  name: string;
  displayName?: string;
}

export interface EnvelopeThread {
  id: string;
  shortId: number;
  title: string | null;
  participants: string[];
}

/** Wire-format payload pushed to recipients on `message:new` over socket.io. */
export interface MessageEnvelope {
  message: Message;
  threadShortId: number;
  thread?: EnvelopeThread;
  peers?: EnvelopePeer[];
}
