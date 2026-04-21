import {
  existsSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { loadIdentity } from "./identity.js";
import { DEFAULT_MCP_SOCK, McpIpcServer } from "./mcp-ipc.js";
import { PaneInbox } from "./pane-inbox.js";
import { PaneRegistry } from "./pane-registry.js";
import { lyyPath } from "./paths.js";
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
 * Inspect an existing PID file without side effects. Returns the pid of
 * another live daemon if one owns this LYY_HOME, or null if we may proceed
 * (no file, malformed contents, stale pid, or self). Extracted for testing —
 * `acquirePidLock` wraps this and actually writes the file + exits on conflict.
 */
export function inspectPidLock(
  pidPath: string,
  myPid: number,
  deps: {
    readFileSync: typeof readFileSync;
    isAlive: (pid: number) => boolean;
  } = {
    readFileSync,
    isAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },
  },
): number | null {
  let raw: string;
  try {
    raw = deps.readFileSync(pidPath, "utf8");
  } catch {
    return null; // No pid file yet.
  }
  // Multi-line format: first line is the daemon pid, optional second line is
  // its parent (tsx shim wrapper). We only conflict-check the first line.
  const firstLine = raw.split("\n")[0]?.trim() ?? "";
  const existing = Number.parseInt(firstLine, 10);
  if (!Number.isFinite(existing) || existing <= 0) return null;
  if (existing === myPid) return null;
  return deps.isAlive(existing) ? existing : null;
}

/**
 * Check the PID file. If it points at a live process that isn't us, another
 * daemon already owns this LYY_HOME — abort to prevent pile-up. Stale PID
 * files (process long gone) are cleared so this daemon can take over.
 */
function acquirePidLock(pidPath: string): void {
  const conflict = inspectPidLock(pidPath, process.pid);
  if (conflict !== null) {
    console.error(
      `[lyy-daemon] another daemon (pid ${conflict}) already running for this LYY_HOME; exiting.`,
    );
    process.exit(2);
  }
  // Record both our pid and the parent pid. When the daemon is launched via
  // the dev tsx shim (or any wrapper), `ps` shows both processes with
  // lyy-daemon-looking command lines — doctor's rogue scan needs both listed
  // as legitimate to avoid false positives.
  const lines = [String(process.pid)];
  if (process.ppid && process.ppid > 1 && process.ppid !== process.pid) {
    lines.push(String(process.ppid));
  }
  writeFileSync(pidPath, `${lines.join("\n")}\n`, { flag: "w" });
}

/**
 * Boot the lyy-daemon process. Loads identity, acquires the per-profile
 * PID lock, opens the pane registry + MCP IPC sockets, connects to relay
 * over WebSocket, wires the router, and returns a handle for graceful
 * shutdown.
 */
export async function startDaemon(): Promise<DaemonHandles> {
  const identity = loadIdentity();
  const pidPath = lyyPath("daemon.pid");
  acquirePidLock(pidPath);

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

  // Self-eviction watchdog: if another daemon replaces the mcp.sock (unlink
  // + bind at the same path), its inode will differ from ours. Voluntarily
  // shut down so we don't become a zombie holding a relay session.
  let myInode: number | null = null;
  try {
    myInode = statSync(DEFAULT_MCP_SOCK).ino;
  } catch {
    // Freshly bound socket should always stat; if not, watchdog just skips.
  }
  let shuttingDown = false;
  let watchdogTriggered = (): void => {
    /* wired below */
  };
  const watchdog = setInterval(() => {
    if (shuttingDown) return;
    try {
      const cur = statSync(DEFAULT_MCP_SOCK).ino;
      if (myInode !== null && cur !== myInode) {
        console.log(
          "[lyy-daemon] mcp.sock inode changed; another daemon took over — exiting",
        );
        watchdogTriggered();
      }
    } catch {
      console.log("[lyy-daemon] mcp.sock missing — likely replaced; exiting");
      watchdogTriggered();
    }
  }, 10_000);
  watchdog.unref();

  console.log(
    `[lyy-daemon] started for peer ${identity.peerId}, relay=${identity.relayUrl}`,
  );

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("[lyy-daemon] shutting down");
    clearInterval(watchdog);
    await relayClient.disconnect();
    await mcp.stop();
    await paneRegistry.stop();
    if (existsSync(pidPath)) {
      try {
        unlinkSync(pidPath);
      } catch {
        // ignore
      }
    }
  };
  // Watchdog triggers the same shutdown path, then force-exits after a brief
  // grace period so we don't leak a replaced daemon forever.
  watchdogTriggered = () => {
    void shutdown().finally(() => process.exit(0));
  };

  return { shutdown };
}

/** Called by bin/lyy-daemon — boots + installs signal handlers. */
export async function run(): Promise<void> {
  const handles = await startDaemon();
  const onSignal = (sig: NodeJS.Signals): void => {
    console.log(`[lyy-daemon] received ${sig}`);
    // Hard deadline: if shutdown() hangs (server.close, socket.io cleanup,
    // anything), force-exit. Without this the daemon becomes a zombie
    // holding its relay session for the CLI that replaced it.
    const hardKill = setTimeout(() => {
      console.error("[lyy-daemon] shutdown timed out; force-exit");
      process.exit(1);
    }, 3000);
    hardKill.unref();
    handles
      .shutdown()
      .catch((err) => console.error("[lyy-daemon] shutdown error:", err))
      .finally(() => {
        clearTimeout(hardKill);
        process.exit(0);
      });
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}
