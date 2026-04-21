import { loadIdentity } from "@lyy/daemon";
import { render } from "ink";
import React from "react";
import { App } from "./app.js";
import {
  fetchPeers,
  fetchState,
  fetchThread,
  makeIpc,
  sendMessage,
  sendToPeer,
  subscribe,
} from "./ipc.js";

export async function main(): Promise<void> {
  const identity = loadIdentity();
  const ipc = makeIpc();
  const [state, peers] = await Promise.all([fetchState(ipc), fetchPeers(ipc)]);
  render(
    <App
      initialState={state}
      initialPeers={peers}
      fetchState={() => fetchState(ipc)}
      fetchPeers={() => fetchPeers(ipc)}
      fetchMessages={(id) => fetchThread(ipc, id)}
      onSend={(threadId, body) => sendMessage(ipc, threadId, body)}
      onSendToPeer={(name, body) => sendToPeer(ipc, name, body)}
      subscribeEvents={(onEvent) => subscribe(onEvent)}
      selfPeerId={identity.peerId}
    />,
  );
}
