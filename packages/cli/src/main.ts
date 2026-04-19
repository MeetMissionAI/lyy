// Entry point: runs when invoked via bin/lyy (dist/main.js) or via
// bin/lyy-dev (tsx src/main.ts). Tests never import this file.
import { main } from "./index.js";

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
