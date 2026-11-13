import { afterEach, describe, expect, it, vi } from "vitest";
import { createCaptcha } from "../src/adapters/captcha.js";
import { createGoogleAuth } from "../src/adapters/google.js";
import { createMailer, sendMail, type EmailBinding } from "../src/adapters/mail.js";
import { buildWorkerEnv } from "../src/entry-worker.js";
import type { Env } from "../src/ports.js";

const BASE_ENV: Env = {
  APP_URL: "https://gifts.example.com",
  SESSION_SECRET: "prod-session-secret-value-at-least-32-chars",
  MAIL_FROM: "Cumplista <noreply@gifts.example.com>",
  MAIL_DRIVER: "console",
};

function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeIdToken(claims: Record<string, unknown>): string {
  const header = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = encodeBase64Url(JSON.stringify(claims));
  return `${header}.${payload}.fakesig`;
}

function resolveUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

describe("v2 adapters and Worker env validation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends sanitized messages via the Cloudflare EMAIL binding and fails when missing", async () => {
    const sent: Parameters<EmailBinding["send"]>[0][] = [];
    const emailBinding: EmailBinding = {
      async send(msg) {
        sent.push(msg);
      },
    };

    const mailer = createMailer(
      { ...BASE_ENV, MAIL_DRIVER: "cloudflare" },
      { EMAIL: emailBinding },
    );

    await mailer.send({
      to: "owner@example.com",
      subject: "Reset\r\nBcc: attacker@example.com\u0000\u007f",
      text: "Reset link",
      html: "<p>Reset link</p>",
    });

    expect(sent).toEqual([
      {
        from: "Cumplista <noreply@gifts.example.com>",
        to: "owner@example.com",
        subject: "ResetBcc: attacker@example.com",
        text: "Reset link",
        html: "<p>Reset link</p>",
      },
    ]);

    const missingBindingMailer = createMailer({
      ...BASE_ENV,
      MAIL_DRIVER: "cloudflare",
    });
    await expect(
      missingBindingMailer.send({
        to: "owner@example.com",
        subject: "Reset",
        text: "Reset link",
        html: "<p>Reset link</p>",
      }),
    ).rejects.toThrow(/EMAIL/);
    expect(
      await sendMail(missingBindingMailer, {
        to: "owner@example.com",
        subject: "Reset",
        text: "Reset link",
        html: "<p>Reset link</p>",
      }),
    ).toBe(false);
  });

  it("uses injected fetchFn and enforces timeout on Resend mail delivery", async () => {
    vi.useFakeTimers();
    let aborted = false;
    const hangingFetch: typeof fetch = (_input, init) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
      });

    const mailer = createMailer(
      {
        ...BASE_ENV,
        MAIL_DRIVER: "resend",
        RESEND_API_KEY: "re_test_key",
      },
      undefined,
      hangingFetch,
    );

    const pending = sendMail(mailer, {
      to: "owner@example.com",
      subject: "Reset",
      text: "Body",
      html: "<p>Body</p>",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toBe(false);
    expect(aborted).toBe(true);
  });

  it("skips Turnstile when unconfigured and verifies tokens with form body and 3s timeout", async () => {
    let unconfiguredCalls = 0;
    const disabled = createCaptcha(
      { ...BASE_ENV, TURNSTILE_SITE_KEY: "site-without-secret" },
      async () => {
        unconfiguredCalls += 1;
        return new Response("{}", { status: 200 });
      },
    );
    expect(disabled.siteKey).toBeNull();
    expect(await disabled.verify("", "203.0.113.5")).toBe(true);
    expect(unconfiguredCalls).toBe(0);

    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const envWithTurnstile: Env = {
      ...BASE_ENV,
      TURNSTILE_SITE_KEY: "0x4AAAAAA_site",
      TURNSTILE_SECRET: "0x4AAAAAA_secret",
    };

    const okCaptcha = createCaptcha(envWithTurnstile, async (input, init) => {
      calls.push({ url: resolveUrl(input), init });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });

    expect(okCaptcha.siteKey).toBe("0x4AAAAAA_site");
    expect(await okCaptcha.verify("", "203.0.113.9")).toBe(false);
    expect(calls).toHaveLength(0);

    expect(await okCaptcha.verify("tok_valid", "203.0.113.9")).toBe(true);
    expect(calls).toHaveLength(1);
    const firstCall = calls[0];
    expect(firstCall?.url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(firstCall?.init?.method).toBe("POST");
    const params = new URLSearchParams(String(firstCall?.init?.body));
    expect(params.get("secret")).toBe("0x4AAAAAA_secret");
    expect(params.get("response")).toBe("tok_valid");
    expect(params.get("remoteip")).toBe("203.0.113.9");

    const rejectedCaptcha = createCaptcha(envWithTurnstile, async () => {
      return new Response(JSON.stringify({ success: false }), { status: 200 });
    });
    expect(await rejectedCaptcha.verify("tok_bad", "203.0.113.9")).toBe(false);

    const httpErrorCaptcha = createCaptcha(envWithTurnstile, async () => {
      return new Response("bad gateway", { status: 502 });
    });
    expect(await httpErrorCaptcha.verify("tok_502", "203.0.113.9")).toBe(false);

    const networkErrorCaptcha = createCaptcha(envWithTurnstile, async () => {
      throw new TypeError("network down");
    });
    expect(await networkErrorCaptcha.verify("tok_net", "203.0.113.9")).toBe(false);

    vi.useFakeTimers();
    let turnstileAborted = false;
    const slowCaptcha = createCaptcha(envWithTurnstile, (_input, init) => {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          turnstileAborted = true;
          reject(new Error("aborted"));
        });
      });
    });
    const slowCheck = slowCaptcha.verify("tok_slow", "203.0.113.9");
    await vi.advanceTimersByTimeAsync(2_999);
    expect(turnstileAborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await slowCheck).toBe(false);
    expect(turnstileAborted).toBe(true);
  });

  it("builds Google PKCE authorize URLs, validates id_token claims, and returns null on failures", async () => {
    const disabled = createGoogleAuth(BASE_ENV);
    expect(disabled.enabled).toBe(false);
    expect(() =>
      disabled.authorizeUrl({ state: "st", codeChallenge: "cc" }),
    ).toThrow(/Google/);
    expect(await disabled.exchange({ code: "c", codeVerifier: "v" })).toBeNull();

    const googleEnv: Env = {
      ...BASE_ENV,
      APP_URL: "https://gifts.example.com/",
      GOOGLE_CLIENT_ID: "cid-123.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "csecret-456",
    };

    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const validToken = makeIdToken({
      iss: "https://accounts.google.com",
      aud: "cid-123.apps.googleusercontent.com",
      sub: "google-sub-42",
      email: "Maria@example.com",
      email_verified: true,
      name: "María López",
    });

    const google = createGoogleAuth(googleEnv, async (input, init) => {
      calls.push({ url: resolveUrl(input), init });
      return new Response(JSON.stringify({ id_token: validToken }), { status: 200 });
    });

    expect(google.enabled).toBe(true);
    const authUrl = new URL(
      google.authorizeUrl({ state: "state-xyz", codeChallenge: "challenge-abc" }),
    );
    expect(authUrl.origin + authUrl.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(authUrl.searchParams.get("client_id")).toBe(
      "cid-123.apps.googleusercontent.com",
    );
    expect(authUrl.searchParams.get("redirect_uri")).toBe(
      "https://gifts.example.com/auth/google/callback",
    );
    expect(authUrl.searchParams.get("response_type")).toBe("code");
    expect(authUrl.searchParams.get("scope")).toBe("openid email profile");
    expect(authUrl.searchParams.get("state")).toBe("state-xyz");
    expect(authUrl.searchParams.get("code_challenge")).toBe("challenge-abc");
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");

    const profile = await google.exchange({
      code: "auth-code-1",
      codeVerifier: "pkce-verifier-1",
    });
    expect(profile).toEqual({
      sub: "google-sub-42",
      email: "Maria@example.com",
      emailVerified: true,
      name: "María López",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0]?.init?.method).toBe("POST");
    const tokenParams = new URLSearchParams(String(calls[0]?.init?.body));
    expect(tokenParams.get("code")).toBe("auth-code-1");
    expect(tokenParams.get("client_id")).toBe("cid-123.apps.googleusercontent.com");
    expect(tokenParams.get("client_secret")).toBe("csecret-456");
    expect(tokenParams.get("redirect_uri")).toBe(
      "https://gifts.example.com/auth/google/callback",
    );
    expect(tokenParams.get("grant_type")).toBe("authorization_code");
    expect(tokenParams.get("code_verifier")).toBe("pkce-verifier-1");

    const bareIssGoogle = createGoogleAuth(googleEnv, async () => {
      const token = makeIdToken({
        iss: "accounts.google.com",
        aud: "cid-123.apps.googleusercontent.com",
        sub: "google-sub-99",
        email: "unverified@example.com",
        email_verified: false,
        name: "Unverified User",
      });
      return new Response(JSON.stringify({ id_token: token }), { status: 200 });
    });
    expect(
      await bareIssGoogle.exchange({ code: "auth-code-2", codeVerifier: "verifier-2" }),
    ).toEqual({
      sub: "google-sub-99",
      email: "unverified@example.com",
      emailVerified: false,
      name: "Unverified User",
    });

    for (const badToken of [
      makeIdToken({
        iss: "https://evil.example.com",
        aud: "cid-123.apps.googleusercontent.com",
        sub: "sub-1",
        email: "a@example.com",
        email_verified: true,
        name: "A",
      }),
      makeIdToken({
        iss: "accounts.google.com",
        aud: "other-client-id",
        sub: "sub-1",
        email: "a@example.com",
        email_verified: true,
        name: "A",
      }),
      makeIdToken({
        iss: "accounts.google.com",
        aud: "cid-123.apps.googleusercontent.com",
        email: "a@example.com",
        email_verified: true,
        name: "A",
      }),
      "not-a-jwt",
    ]) {
      const badGoogle = createGoogleAuth(googleEnv, async () => {
        return new Response(JSON.stringify({ id_token: badToken }), { status: 200 });
      });
      expect(await badGoogle.exchange({ code: "c", codeVerifier: "v" })).toBeNull();
    }

    const httpFailGoogle = createGoogleAuth(googleEnv, async () => {
      return new Response("invalid_grant", { status: 400 });
    });
    expect(await httpFailGoogle.exchange({ code: "c", codeVerifier: "v" })).toBeNull();

    vi.useFakeTimers();
    let googleAborted = false;
    const slowGoogle = createGoogleAuth(googleEnv, (_input, init) => {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          googleAborted = true;
          reject(new Error("aborted"));
        });
      });
    });
    const pendingExchange = slowGoogle.exchange({ code: "c", codeVerifier: "v" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pendingExchange).toBeNull();
    expect(googleAborted).toBe(true);
  });

  it("validates EMAIL binding, Turnstile pairs, Google pairs, SESSION_SECRET, and https APP_URL in buildWorkerEnv", () => {
    const emailBinding: EmailBinding = { async send() {} };
    const validCloudflare = {
      EMAIL: emailBinding,
      APP_URL: "https://gifts.example.com",
      SESSION_SECRET: "prod-session-secret-value-at-least-32-chars",
      MAIL_DRIVER: "cloudflare",
      MAIL_FROM: "Cumplista <noreply@gifts.example.com>",
      TURNSTILE_SITE_KEY: "ts-site",
      TURNSTILE_SECRET: "ts-secret",
      GOOGLE_CLIENT_ID: "g-id",
      GOOGLE_CLIENT_SECRET: "g-secret",
    };

    expect(buildWorkerEnv(validCloudflare)).toEqual({
      APP_URL: "https://gifts.example.com",
      SESSION_SECRET: "prod-session-secret-value-at-least-32-chars",
      MAIL_DRIVER: "cloudflare",
      MAIL_FROM: "Cumplista <noreply@gifts.example.com>",
      TURNSTILE_SITE_KEY: "ts-site",
      TURNSTILE_SECRET: "ts-secret",
      GOOGLE_CLIENT_ID: "g-id",
      GOOGLE_CLIENT_SECRET: "g-secret",
    });

    const { EMAIL: _noEmail, ...withoutEmail } = validCloudflare;
    expect(() => buildWorkerEnv(withoutEmail)).toThrow(/EMAIL/);

    expect(() =>
      buildWorkerEnv({ ...validCloudflare, APP_URL: "http://gifts.example.com" }),
    ).toThrow(/https:/);
    expect(() =>
      buildWorkerEnv({ ...validCloudflare, APP_URL: "http://localhost:8787" }),
    ).toThrow(/Loopback APP_URL/);

    expect(() =>
      buildWorkerEnv({ ...validCloudflare, SESSION_SECRET: "short-secret" }),
    ).toThrow(/SESSION_SECRET/);

    const { TURNSTILE_SECRET: _noTsSecret, ...onlyTsSite } = validCloudflare;
    expect(() => buildWorkerEnv(onlyTsSite)).toThrow(/TURNSTILE/);

    const { TURNSTILE_SITE_KEY: _noTsSite, ...onlyTsSecret } = validCloudflare;
    expect(() => buildWorkerEnv(onlyTsSecret)).toThrow(/TURNSTILE/);

    const { GOOGLE_CLIENT_SECRET: _noGSecret, ...onlyGId } = validCloudflare;
    expect(() => buildWorkerEnv(onlyGId)).toThrow(/GOOGLE/);

    const { GOOGLE_CLIENT_ID: _noGId, ...onlyGSecret } = validCloudflare;
    expect(() => buildWorkerEnv(onlyGSecret)).toThrow(/GOOGLE/);
  });
});
