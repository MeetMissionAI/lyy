export {
  loadIdentity,
  DEFAULT_IDENTITY_PATH,
  type Identity,
} from "./identity.js";
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
export {
  RelayHttp,
  type RelayHttpDeps,
  type SendMessageInput,
  type SendMessageResult,
  type InboxResponse,
} from "./relay-http.js";
export {
  McpIpcServer,
  McpIpcClient,
  DEFAULT_MCP_SOCK,
  type McpIpcServerDeps,
} from "./mcp-ipc.js";
export { getLyyHome, lyyPath } from "./paths.js";
export { startDaemon, type DaemonHandles } from "./main.js";

export const PACKAGE_NAME = "@lyy/daemon";
