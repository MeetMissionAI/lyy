import { loadIdentity } from "./identity.js";
import { McpIpcServer } from "./mcp-ipc.js";
import { PaneInbox } from "./pane-inbox.js";
import { PaneRegistry } from "./pane-registry.js";
import { PresenceStore } from "./presence.js";
import { RelayClient } from "./relay-client.js";
import { RelayHttp } from "./relay-http.js";
import { MessageRouter } from "./router.js";
import { syncStateFromRelay } from "./state-sync.js";
import { StateStore } from "./state.js";

export interface DaemonHandles {
  shutdown: () => Promise<void>;
}

/**
 * Boot the lyy-daemon process. Loads identity, opens the pane registry +
 * MCP IPC sockets, connects to relay over WebSocket, wires the router,
 * and returns a handle for graceful shutdown.
 */
export async function startDaemon(): Promise<DaemonHandles> {
  const identity = loadIdentity();
  const state = new StateStore();
  const paneRegistry = new PaneRegistry();
  const paneInbox = new PaneInbox();

  await paneRegistry.start();

  const relayClient = new RelayClient({
    url: identity.relayUrl,
    token: identity.jwt,
  });
  const relayHttp = new RelayHttp({
    baseUrl: identity.relayUrl,
    jwt: identity.jwt,
  });

  // Presence store mirrors relay's online set; attach to the relay client so
  // snapshot + change deltas flow in. MCP IPC exposes it to readers.
  const presence = new PresenceStore();
  presence.attach(relayClient);

  // Construct the MCP IPC server first so we can wire its push bus into the
  // router's onIncomingMessage callback. mcp.start() only binds the Unix
  // socket — it doesn't wait on the relay — so ordering is safe.
  const mcp = new McpIpcServer({
    relayHttp,
    state,
    paneRegistry,
    paneInbox,
    presence,
  });
  await mcp.start();

  // Fan presence changes out to TUI (and any other IPC subscriber).
  presence.onChange((online) => mcp.pushToSubscribers("presence", { online }));

  const router = new MessageRouter({
    relay: relayClient,
    paneRegistry,
    paneInbox,
    state,
    selfPeerId: identity.peerId,
    onIncomingMessage: (env) => mcp.pushToSubscribers("message:new", env),
  });
  router.start();

  let relayConnected = false;
  mcp.setRelayStatusProvider(() => relayConnected);

  relayClient.on("connected", async () => {
    console.log("[lyy-daemon] relay connected");
    relayConnected = true;
    mcp.pushToSubscribers("relay:status", { connected: true });
    try {
      await syncStateFromRelay({
        relayHttp,
        state,
        paneInbox,
        selfPeerId: identity.peerId,
      });
      console.log("[lyy-daemon] state sync complete");
    } catch (err) {
      console.log(`[lyy-daemon] state sync failed: ${(err as Error).message}`);
    }
  });
  relayClient.on("disconnected", (reason) => {
    console.log(`[lyy-daemon] relay disconnected: ${reason}`);
    relayConnected = false;
    mcp.pushToSubscribers("relay:status", { connected: false });
  });
  relayClient.on("connect_error", (err) =>
    console.log(`[lyy-daemon] relay connect_error: ${(err as Error).message}`),
  );
  relayClient.on("message:new", (env) => {
    const e = env as {
      message: { seq: number; fromPeer: string };
      threadShortId: number;
    };
    console.log(
      `[lyy-daemon] message:new thread=#${e.threadShortId} seq=${e.message.seq} from=${e.message.fromPeer}`,
    );
  });

  relayClient.connect();

  console.log(
    `[lyy-daemon] started for peer ${identity.peerId}, relay=${identity.relayUrl}`,
  );

  return {
    shutdown: async () => {
      console.log("[lyy-daemon] shutting down");
      relayClient.disconnect();
      await mcp.stop();
      await paneRegistry.stop();
    },
  };
}

/** Called by bin/lyy-daemon — boots + installs signal handlers. */
export async function run(): Promise<void> {
  const handles = await startDaemon();
  const onSignal = (sig: NodeJS.Signals) => {
    console.log(`[lyy-daemon] received ${sig}`);
    handles.shutdown().finally(() => process.exit(0));
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}
