import { main } from "./index.js";

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
