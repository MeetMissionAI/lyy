import { createDb } from "@lyy/shared";
import { buildServer } from "./server.js";
import { attachSocket } from "./socket.js";

interface BootEnv {
  databaseUrl: string;
  jwtSecret: string;
  port: number;
  host: string;
}

function readEnv(env: NodeJS.ProcessEnv): BootEnv {
  const databaseUrl = env.DATABASE_URL;
  const jwtSecret = env.JWT_SIGNING_KEY;
  if (!databaseUrl) throw new Error("DATABASE_URL not set");
  if (!jwtSecret) throw new Error("JWT_SIGNING_KEY not set");
  return {
    databaseUrl,
    jwtSecret,
    port: Number.parseInt(env.PORT ?? "3000", 10),
    host: env.HOST ?? "0.0.0.0",
  };
}

export async function startRelay(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  shutdown: () => Promise<void>;
}> {
  const cfg = readEnv(env);
  const db = createDb(cfg.databaseUrl);
  const deps = { db, jwtSecret: cfg.jwtSecret, logger: true };

  const app = await buildServer(deps);
  await app.listen({ port: cfg.port, host: cfg.host });
  const io = attachSocket(app.server, deps);

  app.log.info(`[lyy-relay] listening on ${cfg.host}:${cfg.port}`);

  const shutdown = async () => {
    app.log.info("[lyy-relay] shutting down");
    await new Promise<void>((res) => io.close(() => res()));
    await app.close();
    await db.end();
  };

  return { shutdown };
}

const isDirectInvocation = import.meta.url === `file://${process.argv[1]}`;
if (isDirectInvocation) {
  startRelay()
    .then(({ shutdown }) => {
      const onSignal = (sig: NodeJS.Signals) => {
        console.log(`[lyy-relay] received ${sig}`);
        shutdown()
          .catch((err) => console.error("[lyy-relay] shutdown error:", err))
          .finally(() => process.exit(0));
      };
      process.on("SIGINT", onSignal);
      process.on("SIGTERM", onSignal);
    })
    .catch((err) => {
      console.error("[lyy-relay] boot failed:", err);
      process.exit(1);
    });
}
