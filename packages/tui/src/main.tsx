import { loadIdentity } from "@lyy/daemon";
import { render } from "ink";
import React from "react";
import { App } from "./app.js";
import { fetchState, fetchThread, makeIpc } from "./ipc.js";

export async function main(): Promise<void> {
  const identity = loadIdentity();
  const ipc = makeIpc();
  const state = await fetchState(ipc);
  render(
    <App
      initialState={state}
      fetchMessages={(id) => fetchThread(ipc, id)}
      selfPeerId={identity.peerId}
    />,
  );
}
