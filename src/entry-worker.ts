import type { ExecutionContext } from "hono";
import { createCaptcha } from "./adapters/captcha.js";
import { createD1Sql, type D1Database } from "./adapters/d1.js";
import { createGoogleAuth } from "./adapters/google.js";
import { createMailer, type EmailBinding } from "./adapters/mail.js";
import { createApp } from "./app.js";
import type { Deps, Env } from "./ports.js";

export type WorkerBindings = {
  DB: D1Database;
  EMAIL?: EmailBinding | undefined;
  APP_URL?: string | undefined;
  SESSION_SECRET?: string | undefined;
  MAIL_FROM?: string | undefined;
  MAIL_DRIVER?: string | undefined;
  ALLOW_CONSOLE_MAIL?: string | undefined;
  RESEND_API_KEY?: string | undefined;
  SMTP_URL?: string | undefined;
  TURNSTILE_SITE_KEY?: string | undefined;
  TURNSTILE_SECRET?: string | undefined;
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
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
  if (
    rawDriver !== "console" &&
    rawDriver !== "cloudflare" &&
    rawDriver !== "resend"
  ) {
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

  if (rawDriver === "cloudflare" && typeof bindings.EMAIL?.send !== "function") {
    throw new Error("EMAIL binding is required when MAIL_DRIVER=cloudflare");
  }

  const resendApiKey = bindings.RESEND_API_KEY?.trim() ?? "";
  if (rawDriver === "resend" && !resendApiKey) {
    throw new Error("RESEND_API_KEY is required when MAIL_DRIVER=resend");
  }

  const turnstileSiteKey = bindings.TURNSTILE_SITE_KEY?.trim() ?? "";
  const turnstileSecret = bindings.TURNSTILE_SECRET?.trim() ?? "";
  if (Boolean(turnstileSiteKey) !== Boolean(turnstileSecret)) {
    throw new Error(
      "TURNSTILE_SITE_KEY and TURNSTILE_SECRET must both be set or both be unset",
    );
  }

  const googleClientId = bindings.GOOGLE_CLIENT_ID?.trim() ?? "";
  const googleClientSecret = bindings.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  if (Boolean(googleClientId) !== Boolean(googleClientSecret)) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must both be set or both be unset",
    );
  }

  const smtpUrl = bindings.SMTP_URL?.trim() ?? "";

  return {
    APP_URL: rawAppUrl,
    SESSION_SECRET: sessionSecret,
    MAIL_FROM: mailFrom,
    MAIL_DRIVER: rawDriver,
    ...(resendApiKey ? { RESEND_API_KEY: resendApiKey } : {}),
    ...(smtpUrl ? { SMTP_URL: smtpUrl } : {}),
    ...(turnstileSiteKey ? { TURNSTILE_SITE_KEY: turnstileSiteKey } : {}),
    ...(turnstileSecret ? { TURNSTILE_SECRET: turnstileSecret } : {}),
    ...(googleClientId ? { GOOGLE_CLIENT_ID: googleClientId } : {}),
    ...(googleClientSecret ? { GOOGLE_CLIENT_SECRET: googleClientSecret } : {}),
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
      mailer: createMailer(env, bindings),
      captcha: createCaptcha(env),
      google: createGoogleAuth(env),
      env,
      now: () => new Date(),
      clientIp: (req) => resolveWorkerClientIp(req),
    };
    const app = createApp(() => deps);
    return app.fetch(request, bindings, executionCtx);
  },
};
