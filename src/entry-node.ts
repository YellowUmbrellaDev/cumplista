import { existsSync } from "node:fs";
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
  console.warn("Warning: SESSION_SECRET is not set; using insecure development default.");
  return "cumplista-dev-insecure-session-secret";
}

const port = parsePort(process.env.PORT);
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
