import type { Captcha, Env } from "../ports.js";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_TIMEOUT_MS = 3_000;

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
        reject(new Error(`Turnstile request timed out after ${timeoutMs}ms`));
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

export function createCaptcha(env: Env, fetchFn?: typeof fetch): Captcha {
  const secret = env.TURNSTILE_SECRET?.trim() ?? "";
  if (!secret) {
    return {
      siteKey: null,
      async verify(): Promise<boolean> {
        return true;
      },
    };
  }

  const siteKey = env.TURNSTILE_SITE_KEY?.trim() || null;

  return {
    siteKey,
    async verify(token: string, ip: string): Promise<boolean> {
      if (!token) {
        return false;
      }
      const body = new URLSearchParams({
        secret,
        response: token,
        remoteip: ip,
      });
      try {
        const response = await fetchWithTimeout(
          fetchFn,
          TURNSTILE_VERIFY_URL,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
          },
          TURNSTILE_TIMEOUT_MS,
        );
        if (!response.ok) {
          return false;
        }
        const data: unknown = await response.json();
        return (
          typeof data === "object" &&
          data !== null &&
          "success" in data &&
          data.success === true
        );
      } catch {
        return false;
      }
    },
  };
}
