import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createMailer } from "./adapters/mail.js";
import { createSqliteSql } from "./adapters/sqlite.js";
import { createApp } from "./app.js";
import type { Deps, Env } from "./ports.js";

const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));

function parsePort(raw: string | undefined): number {
  if (!raw) return 8787;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid PORT: ${raw}`);
  }
  return parsed;
}

function parseMailDriver(raw: string | undefined): Env["MAIL_DRIVER"] {
  if (!raw || raw === "console") return "console";
  if (raw === "resend" || raw === "smtp") return raw;
  throw new Error(`Invalid MAIL_DRIVER: ${raw}`);
}

function resolveSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length > 0) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is required when NODE_ENV=production");
  }
  console.warn("Warning: SESSION_SECRET is not set, using insecure development default.");
  return "cumplista-dev-insecure-session-secret";
}

function extractSocketRemoteAddress(runtime: unknown): string {
  if (typeof runtime !== "object" || runtime === null) return "";
  const candidate =
    "server" in runtime && typeof runtime.server === "object" && runtime.server !== null
      ? runtime.server
      : runtime;
  if (!("incoming" in candidate)) return "";
  const incoming = candidate.incoming;
  if (typeof incoming !== "object" || incoming === null || !("socket" in incoming)) return "";
  const socket = incoming.socket;
  if (typeof socket !== "object" || socket === null || !("remoteAddress" in socket)) return "";
  return typeof socket.remoteAddress === "string" ? socket.remoteAddress.trim() : "";
}

export function resolveNodeClientIp(
  req: Request,
  runtime: unknown,
  trustProxy = process.env.TRUST_PROXY === "1",
): string {
  if (trustProxy) {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) {
      const parts = xff
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      const last = parts[parts.length - 1];
      if (last) return last;
    }
  }
  return extractSocketRemoteAddress(runtime);
}

function isMainModule(): boolean {
  const entryArg = process.argv[1];
  if (!entryArg) return false;
  try {
    return realpathSync(resolve(entryArg)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

function startNodeServer(): void {
  const port = parsePort(process.env.PORT);
  const trustProxy = process.env.TRUST_PROXY === "1";
  const env: Env = {
    APP_URL: process.env.APP_URL || `http://localhost:${port}`,
    SESSION_SECRET: resolveSessionSecret(),
    MAIL_FROM: process.env.MAIL_FROM || "Cumplista <hola@localhost>",
    MAIL_DRIVER: parseMailDriver(process.env.MAIL_DRIVER),
    ...(process.env.RESEND_API_KEY ? { RESEND_API_KEY: process.env.RESEND_API_KEY } : {}),
    ...(process.env.SMTP_URL ? { SMTP_URL: process.env.SMTP_URL } : {}),
  };

  const sql = createSqliteSql(process.env.DATA_DIR);
  const mailer = createMailer(env);
  const deps: Deps = {
    sql,
    mailer,
    env,
    now: () => new Date(),
    clientIp: (req, runtime) => resolveNodeClientIp(req, runtime, trustProxy),
  };

  const serverApp = new Hono();
  if (existsSync(PUBLIC_DIR)) {
    serverApp.use("/*", serveStatic({ root: PUBLIC_DIR }));
  }
  serverApp.route("/", createApp(() => deps));

  const server = serve({ fetch: serverApp.fetch, port }, (info) => {
    console.info(`Cumplista listening on http://localhost:${info.port}`);
  });

  function shutdown() {
    server.close(() => {
      sql.close();
      process.exit(0);
    });
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (isMainModule()) {
  startNodeServer();
}
