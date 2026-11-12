import type { ExecutionContext } from "hono";
import { createD1Sql, type D1Database } from "./adapters/d1.js";
import { createMailer } from "./adapters/mail.js";
import { createApp } from "./app.js";
import type { Deps, Env } from "./ports.js";

export type WorkerBindings = {
  DB: D1Database;
  APP_URL?: string;
  SESSION_SECRET?: string;
  MAIL_FROM?: string;
  MAIL_DRIVER?: string;
  ALLOW_CONSOLE_MAIL?: string;
  RESEND_API_KEY?: string;
  SMTP_URL?: string;
};

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1"
  );
}

export function resolveWorkerClientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip")?.trim() ?? "";
}

export function buildWorkerEnv(bindings: Omit<WorkerBindings, "DB">): Env {
  const sessionSecret = bindings.SESSION_SECRET?.trim() ?? "";
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET is required");
  }
  if (sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters");
  }

  const rawDriver = bindings.MAIL_DRIVER?.trim() ?? "";
  if (!rawDriver) {
    throw new Error("MAIL_DRIVER is required");
  }
  if (rawDriver === "smtp") {
    throw new Error("MAIL_DRIVER=smtp is not supported on Cloudflare Workers");
  }
  if (rawDriver !== "console" && rawDriver !== "resend") {
    throw new Error(`Invalid MAIL_DRIVER: ${rawDriver}`);
  }

  const rawAppUrl = bindings.APP_URL?.trim() ?? "";
  if (!rawAppUrl) {
    throw new Error("APP_URL is required");
  }
  let parsedAppUrl: URL;
  try {
    parsedAppUrl = new URL(rawAppUrl);
  } catch {
    throw new Error(`Invalid APP_URL: ${rawAppUrl}`);
  }
  if (parsedAppUrl.protocol !== "http:" && parsedAppUrl.protocol !== "https:") {
    throw new Error(`Invalid APP_URL protocol: ${parsedAppUrl.protocol}`);
  }

  const loopback = isLoopbackHost(parsedAppUrl.hostname);
  if (!loopback && parsedAppUrl.protocol !== "https:") {
    throw new Error("APP_URL must use https: unless host is loopback");
  }

  if (rawDriver === "console") {
    if (bindings.ALLOW_CONSOLE_MAIL !== "1") {
      throw new Error("MAIL_DRIVER=console requires ALLOW_CONSOLE_MAIL=1 on Cloudflare Workers");
    }
    if (!loopback) {
      throw new Error("MAIL_DRIVER=console is only allowed when APP_URL is loopback");
    }
  } else if (loopback) {
    throw new Error("Loopback APP_URL is not allowed on Cloudflare Workers");
  }

  const mailFrom =
    bindings.MAIL_FROM?.trim() || (rawDriver === "console" ? "Cumplista <hola@localhost>" : "");
  if (!mailFrom) {
    throw new Error("MAIL_FROM is required");
  }

  if (rawDriver === "resend" && !bindings.RESEND_API_KEY?.trim()) {
    throw new Error("RESEND_API_KEY is required when MAIL_DRIVER=resend");
  }

  return {
    APP_URL: rawAppUrl,
    SESSION_SECRET: sessionSecret,
    MAIL_FROM: mailFrom,
    MAIL_DRIVER: rawDriver,
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
      clientIp: (req) => resolveWorkerClientIp(req),
    };
    const app = createApp(() => deps);
    return app.fetch(request, bindings, executionCtx);
  },
};
