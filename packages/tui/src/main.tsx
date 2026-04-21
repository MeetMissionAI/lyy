import { render } from "ink";
import React from "react";
import { App } from "./app.js";
import { fetchState, makeIpc } from "./ipc.js";

export async function main(): Promise<void> {
  const ipc = makeIpc();
  const state = await fetchState(ipc);
  render(<App initialState={state} />);
}
