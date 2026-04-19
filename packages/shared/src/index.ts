export type {
  Attachment,
  InboxSummary,
  InboxThreadSummary,
  Message,
  Peer,
  Thread,
} from "./types.js";

export { createDb, type Db } from "./db.js";

export {
  createPeer,
  findPeerByEmail,
  findPeerByName,
  listPeers,
  type CreatePeerInput,
} from "./repo/peers.js";

export const PACKAGE_NAME = "@lyy/shared";
