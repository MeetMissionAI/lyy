import { Text, render } from "ink";
import React from "react";

function App() {
  return <Text>lyy-tui v0 — Ink wired.</Text>;
}

export async function main(): Promise<void> {
  render(<App />);
}
