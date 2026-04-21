import { loadIdentity } from "@lyy/daemon";
import { render } from "ink";
import React from "react";
import { App } from "./app.js";
import { fetchState, fetchThread, makeIpc, subscribe } from "./ipc.js";

export async function main(): Promise<void> {
  const identity = loadIdentity();
  const ipc = makeIpc();
  const state = await fetchState(ipc);
  render(
    <App
      initialState={state}
      fetchState={() => fetchState(ipc)}
      fetchMessages={(id) => fetchThread(ipc, id)}
      subscribeEvents={(onEvent) => subscribe(onEvent)}
      selfPeerId={identity.peerId}
    />,
  );
}
