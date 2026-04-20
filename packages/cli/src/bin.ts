import { homedir } from "node:os";
import { resolve } from "node:path";

// `--profile NAME` is parsed before *anything else* (including imports of
// modules that read LYY_HOME at load time, e.g. @lyy/daemon's DEFAULT_MCP_SOCK).
// ESM hoists `import` statements above top-level code, so we must keep this
// file's static imports limited to node builtins and use a dynamic import for
// `./index.js`.
const profileIdx = process.argv.indexOf("--profile");
if (profileIdx > 0 && process.argv[profileIdx + 1]) {
  const name = process.argv[profileIdx + 1];
  process.env.LYY_HOME = resolve(homedir(), ".lyy", "profiles", name);
  process.argv.splice(profileIdx, 2);
}

const { main } = await import("./index.js");
main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
