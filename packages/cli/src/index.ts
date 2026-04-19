import { Command } from "commander";
import { runAdminInvite } from "./commands/admin.js";
import { runDefault } from "./commands/default.js";
import { runDoctor } from "./commands/doctor.js";
import { type HookEvent, runHook } from "./commands/hook.js";
import { type InitOptions, runInit } from "./commands/init.js";
import { runStatusline } from "./commands/statusline.js";
import { runThread } from "./commands/thread.js";

export function buildCli(): Command {
  const program = new Command()
    .name("lyy")
    .description(
      "Link Your Yarn — peer-to-peer chat between Claude Code sessions",
    )
    .version("0.1.0")
    .helpCommand(false);

  program
    .command("init")
    .description(
      "Pair with the relay (consume invite + install daemon + register MCP)",
    )
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
    .description(
      "Health check: identity, daemon, relay, zellij, claude, settings.json",
    )
    .action(async () => runDoctor());

  program
    .command("statusline")
    .description(
      "Print LYY statusLine (called by Claude Code statusLine config)",
    )
    .action(async () => runStatusline());

  program
    .command("hook <event>")
    .description(
      "Internal hook dispatcher (session-start | prompt-submit | stop)",
    )
    .action(async (event: string) => runHook(event as HookEvent));

  const admin = program
    .command("admin")
    .description("Admin operations (invites, peer management, ...)");
  admin
    .command("invite <email>")
    .description("Issue a one-time pairing code (writes to invites table)")
    .option("--days <n>", "Expiry window in days (default: 7)", (v) =>
      Number.parseInt(v, 10),
    )
    .option("--code <code>", "Override the generated code")
    .option("--db-url <url>", "DB URL (default: env DATABASE_URL)")
    .option("--relay-url <url>", "Relay URL printed in the join command")
    .action(
      async (
        email: string,
        opts: {
          days?: number;
          code?: string;
          dbUrl?: string;
          relayUrl?: string;
        },
      ) => runAdminInvite({ email, ...opts }),
    );

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
