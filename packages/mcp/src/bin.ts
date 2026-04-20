import { run } from "./main.js";

run().catch((err) => {
  console.error("[lyy-mcp] fatal:", err);
  process.exit(1);
});
