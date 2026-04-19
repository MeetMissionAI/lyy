export { loadIdentity, DEFAULT_IDENTITY_PATH, type Identity } from "./identity.js";
export { RelayClient, type RelayClientOptions } from "./relay-client.js";
export {
  StateStore,
  StateSchema,
  DEFAULT_STATE_PATH,
  type State,
  type ThreadSummary,
} from "./state.js";
export {
  PaneRegistry,
  PaneRegistryClient,
  DEFAULT_PANE_REGISTRY_SOCK,
} from "./pane-registry.js";
export {
  PaneInbox,
  DEFAULT_INBOX_DIR,
  type PaneInboxEntry,
} from "./pane-inbox.js";
export {
  MessageRouter,
  type MessageEnvelope,
  type RouterDeps,
} from "./router.js";

export const PACKAGE_NAME = "@lyy/daemon";
