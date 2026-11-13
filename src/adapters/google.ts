import type { Env, GoogleAuth, GoogleProfile } from "../ports.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeBase64UrlUtf8(segment: string): string | null {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(segment)) {
    return null;
  }
  const unpadded = segment.replace(/=+$/, "");
  if (unpadded.length % 4 === 1) {
    return null;
  }
  const padded = unpadded
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(unpadded.length + ((4 - (unpadded.length % 4)) % 4), "=");
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function parseIdToken(idToken: string, clientId: string): GoogleProfile | null {
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const payloadSegment = parts[1];
  if (!payloadSegment) {
    return null;
  }
  const json = decodeBase64UrlUtf8(payloadSegment);
  if (json === null) {
    return null;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(payload)) {
    return null;
  }
  const { iss, aud, sub, email, email_verified, name } = payload;
  if (iss !== "accounts.google.com" && iss !== "https://accounts.google.com") {
    return null;
  }
  if (aud !== clientId) {
    return null;
  }
  if (typeof sub !== "string" || sub.trim().length === 0) {
    return null;
  }
  if (typeof email !== "string" || email.trim().length === 0) {
    return null;
  }
  if (typeof email_verified !== "boolean") {
    return null;
  }
  if (name !== undefined && typeof name !== "string") {
    return null;
  }
  const trimmedEmail = email.trim();
  const resolvedName =
    typeof name === "string" && name.trim().length > 0
      ? name.trim()
      : (trimmedEmail.split("@")[0] || trimmedEmail);

  return {
    sub,
    email: trimmedEmail,
    emailVerified: email_verified,
    name: resolvedName,
  };
}

async function fetchWithTimeout(
  fetchFn: typeof fetch | undefined,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`Google token request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    const doFetch: typeof fetch =
      fetchFn ?? ((input, reqInit) => globalThis.fetch(input, reqInit));
    const pending = Promise.resolve().then(() =>
      doFetch(url, { ...init, signal: controller.signal }),
    );
    return await Promise.race([pending, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createGoogleAuth(env: Env, fetchFn?: typeof fetch): GoogleAuth {
  const clientId = env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  const enabled = Boolean(clientId && clientSecret);
  const redirectUri = `${env.APP_URL.replace(/\/+$/, "")}/auth/google/callback`;

  return {
    enabled,
    authorizeUrl(params: { state: string; codeChallenge: string }): string {
      if (!enabled) {
        throw new Error("Google sign-in is not configured");
      }
      const url = new URL(GOOGLE_AUTH_URL);
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("state", params.state);
      url.searchParams.set("code_challenge", params.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      return url.toString();
    },
    async exchange(params: {
      code: string;
      codeVerifier: string;
    }): Promise<GoogleProfile | null> {
      if (!enabled || !params.code || !params.codeVerifier) {
        return null;
      }
      const body = new URLSearchParams({
        code: params.code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: params.codeVerifier,
      });
      try {
        const response = await fetchWithTimeout(
          fetchFn,
          GOOGLE_TOKEN_URL,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
          },
          GOOGLE_TIMEOUT_MS,
        );
        if (!response.ok) {
          return null;
        }
        const data: unknown = await response.json();
        if (!isRecord(data) || typeof data.id_token !== "string") {
          return null;
        }
        return parseIdToken(data.id_token, clientId);
      } catch {
        return null;
      }
    },
  };
}
