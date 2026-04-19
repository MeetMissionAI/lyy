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
