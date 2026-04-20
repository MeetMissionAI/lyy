import { homedir } from "node:os";
import { resolve } from "node:path";
import { main } from "./index.js";

// `--profile NAME` is parsed before commander so it applies to every
// subcommand uniformly (init / repair / default / etc.). It expands to
// LYY_HOME=~/.lyy/profiles/NAME so daemon, identity, sockets, state and
// the zellij session are all isolated per profile.
const profileIdx = process.argv.indexOf("--profile");
if (profileIdx > 0 && process.argv[profileIdx + 1]) {
  const name = process.argv[profileIdx + 1];
  process.env.LYY_HOME = resolve(homedir(), ".lyy", "profiles", name);
  process.argv.splice(profileIdx, 2);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
