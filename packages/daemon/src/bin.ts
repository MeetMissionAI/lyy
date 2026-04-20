// Entry point for bin/lyy-daemon (and dev variant). Side-effect only —
// library consumers must NOT import this file; they import from index.
import { run } from "./main.js";

run().catch((err) => {
  console.error("[lyy-daemon] boot failed:", err);
  process.exit(1);
});
