import { Command } from "commander";
import { runDefault } from "./commands/default.js";
import { runDoctor } from "./commands/doctor.js";
import { runInit, type InitOptions } from "./commands/init.js";
import { runThread } from "./commands/thread.js";

export function buildCli(): Command {
  const program = new Command()
    .name("lyy")
    .description("Link Your Yarn — peer-to-peer chat between Claude Code sessions")
    .version("0.1.0")
    .helpCommand(false);

  program
    .command("init")
    .description("Pair with the relay (consume invite + install daemon + register MCP)")
    .option("--invite <code>", "Invite code from your admin")
    .option("--name <name>", "Your peer @name (e.g. leo)")
    .option("--email <email>", "Your team email")
    .option("--relay-url <url>", "Relay base URL (env: LYY_RELAY_URL)")
    .option("--no-launch-agent", "Skip macOS LaunchAgent install")
    .action(async (opts: InitOptions) => runInit(opts));

  program
    .command("thread <shortId>")
    .description("Open a peer thread in a new pane")
    .action(async (shortId: string) => {
      await runThread(Number.parseInt(shortId, 10));
    });

  program
    .command("doctor")
    .description("Health check: identity, daemon, relay, zellij, claude, settings.json")
    .action(async () => runDoctor());

  program.action(async () => runDefault());

  return program;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  await buildCli().parseAsync(argv);
}

const isDirectInvocation = import.meta.url === `file://${process.argv[1]}`;
if (isDirectInvocation) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
