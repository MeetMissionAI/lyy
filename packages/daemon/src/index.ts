export { loadIdentity, DEFAULT_IDENTITY_PATH, type Identity } from "./identity.js";
export { RelayClient, type RelayClientOptions } from "./relay-client.js";
export {
  StateStore,
  StateSchema,
  DEFAULT_STATE_PATH,
  type State,
  type ThreadSummary,
} from "./state.js";

export const PACKAGE_NAME = "@lyy/daemon";
