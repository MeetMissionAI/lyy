export type {
  Attachment,
  InboxSummary,
  InboxThreadSummary,
  Message,
  Peer,
  Thread,
} from "./types.js";

export { createDb, type Db, type Queryable } from "./db.js";

export {
  createPeer,
  findPeerByEmail,
  findPeerByName,
  listPeers,
  type CreatePeerInput,
} from "./repo/peers.js";

export {
  createThread,
  findActiveThread,
  getThreadById,
  getThreadByShortId,
  listThreadsForPeer,
  type CreateThreadInput,
  type ThreadListItem,
} from "./repo/threads.js";

export {
  insertMessage,
  listMessages,
  searchMessages,
  type InsertMessageInput,
  type SearchOptions,
} from "./repo/messages.js";

export {
  markRead,
  markThreadRead,
  unreadCountForPeer,
  unreadCountForThread,
} from "./repo/reads.js";

export {
  archiveThread,
  isArchived,
  unarchiveThread,
} from "./repo/archives.js";

export const PACKAGE_NAME = "@lyy/shared";
