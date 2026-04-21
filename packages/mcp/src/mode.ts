export type Mode = { kind: "main" };

/**
 * MCP mode detection. LYY TUI replaces per-thread Claude panes, so the MCP
 * always runs in main mode now. The `Mode` type is retained (as a
 * single-variant union) so downstream consumers compile unchanged.
 */
export function detectMode(): Mode {
  return { kind: "main" };
}
