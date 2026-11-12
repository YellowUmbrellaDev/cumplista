import type { ExecutionContext } from "hono";
import { createD1Sql, type D1Database } from "./adapters/d1.js";
import { createMailer } from "./adapters/mail.js";
import { createApp } from "./app.js";
import type { Deps, Env } from "./ports.js";

export type WorkerBindings = {
  DB: D1Database;
  APP_URL: string;
  SESSION_SECRET: string;
  MAIL_FROM?: string;
  MAIL_DRIVER?: string;
  RESEND_API_KEY?: string;
  SMTP_URL?: string;
};

function parseMailDriver(raw: string | undefined): Env["MAIL_DRIVER"] {
  if (raw === "console" || raw === "resend" || raw === "smtp") return raw;
  return "console";
}

function buildWorkerEnv(bindings: WorkerBindings): Env {
  if (!bindings.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is required");
  }
  return {
    APP_URL: bindings.APP_URL || "http://localhost:8787",
    SESSION_SECRET: bindings.SESSION_SECRET,
    MAIL_FROM: bindings.MAIL_FROM || "Cumplista <hola@example.com>",
    MAIL_DRIVER: parseMailDriver(bindings.MAIL_DRIVER),
    ...(bindings.RESEND_API_KEY ? { RESEND_API_KEY: bindings.RESEND_API_KEY } : {}),
    ...(bindings.SMTP_URL ? { SMTP_URL: bindings.SMTP_URL } : {}),
  };
}

export default {
  async fetch(
    request: Request,
    bindings: WorkerBindings,
    executionCtx?: ExecutionContext,
  ): Promise<Response> {
    const env = buildWorkerEnv(bindings);
    const deps: Deps = {
      sql: createD1Sql(bindings.DB),
      mailer: createMailer(env),
      env,
      now: () => new Date(),
    };
    const app = createApp(() => deps);
    return app.fetch(request, bindings, executionCtx);
  },
};
