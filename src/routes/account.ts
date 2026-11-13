import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { ownerCookieName, randomToken, signValue, verifyValue } from "../domain/auth.js";
import {
  completeReset,
  loginWithPassword,
  previewReset,
  requestPasswordReset,
  signInWithGoogle,
  signupWithPassword,
} from "../domain/users.js";
import { isLocale } from "../i18n/index.js";
import type { Deps } from "../ports.js";
import {
  ForgotView,
  LandingView,
  LoginView,
  ResetView,
  SignupView,
} from "../views/pages.js";
import {
  buildChrome,
  clientBucket,
  formString,
  isHttpsApp,
  MAX_FORM_BYTES,
  parseSafeBack,
  pickRequestLocale,
  readForm,
  resolveOwner,
  SESSION_MAX_AGE_SECONDS,
  setOwnerSession,
} from "./http.js";

const OAUTH_COOKIE = "cp_oauth";
const OAUTH_TTL_SECONDS = 600;

async function captchaOk(deps: Deps, c: Context, form: URLSearchParams): Promise<boolean> {
  if (deps.captcha.siteKey === null) return true;
  const token = formString(form, "cf-turnstile-response");
  if (!token) return false;
  return deps.captcha.verify(token, deps.clientIp(c.req.raw, c.env));
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function accountRoutes(getDeps: () => Deps): Hono {
  const app = new Hono();
  const postBodyLimit = bodyLimit({ maxSize: MAX_FORM_BYTES });

  app.post("/lang", postBodyLimit, async (c) => {
    const deps = getDeps();
    const form = await readForm(c);
    const lang = formString(form, "lang").trim();
    if (isLocale(lang)) {
      setCookie(c, "lang", lang, {
        httpOnly: true,
        secure: isHttpsApp(deps.env.APP_URL),
        sameSite: "Lax",
        path: "/",
        maxAge: SESSION_MAX_AGE_SECONDS,
      });
    }
    return c.redirect(parseSafeBack(formString(form, "back")));
  });

  app.get("/", async (c) => {
    const deps = getDeps();
    if (await resolveOwner(c, deps)) return c.redirect("/dashboard");
    return c.html(LandingView({ chrome: buildChrome(c, "/") }));
  });

  app.get("/signup", async (c) => {
    const deps = getDeps();
    if (await resolveOwner(c, deps)) return c.redirect("/dashboard");
    return c.html(
      SignupView({
        chrome: buildChrome(c, "/signup"),
        captchaSiteKey: deps.captcha.siteKey,
        googleEnabled: deps.google.enabled,
        values: { name: "", email: "" },
      }),
    );
  });

  app.post("/signup", postBodyLimit, async (c) => {
    const deps = getDeps();
    const form = await readForm(c);
    const values = { name: formString(form, "name").trim(), email: formString(form, "email").trim() };
    const page = (error: NonNullable<Parameters<typeof SignupView>[0]["error"]>, status: 400 | 429) =>
      c.html(
        SignupView({
          chrome: buildChrome(c, "/signup"),
          captchaSiteKey: deps.captcha.siteKey,
          googleEnabled: deps.google.enabled,
          values,
          error,
        }),
        status,
      );
    if (!(await captchaOk(deps, c, form))) return page("captcha", 400);
    const res = await signupWithPassword(
      deps,
      { ...values, password: formString(form, "password") },
      clientBucket(c, deps, 48),
      pickRequestLocale(c),
    );
    if (!res.ok) return page(res.error, res.error === "rate-limited" ? 429 : 400);
    await setOwnerSession(c, deps, res.value.user.id, res.value.epoch);
    return c.redirect("/dashboard");
  });

  app.get("/login", async (c) => {
    const deps = getDeps();
    if (await resolveOwner(c, deps)) return c.redirect("/dashboard");
    const failed = c.req.query("error") === "google";
    return c.html(
      LoginView({
        chrome: buildChrome(c, "/login"),
        googleEnabled: deps.google.enabled,
        email: "",
        ...(failed ? { error: "google-failed" as const } : {}),
      }),
    );
  });

  app.post("/login", postBodyLimit, async (c) => {
    const deps = getDeps();
    const form = await readForm(c);
    const email = formString(form, "email").trim();
    const res = await loginWithPassword(
      deps,
      { email, password: formString(form, "password") },
      clientBucket(c, deps),
    );
    if (!res.ok) {
      return c.html(
        LoginView({
          chrome: buildChrome(c, "/login"),
          googleEnabled: deps.google.enabled,
          email,
          error: res.error,
        }),
        res.error === "throttled" ? 429 : 401,
      );
    }
    await setOwnerSession(c, deps, res.value.user.id, res.value.epoch);
    return c.redirect("/dashboard");
  });

  app.post("/logout", postBodyLimit, (c) => {
    deleteCookie(c, ownerCookieName(), { path: "/" });
    return c.redirect("/");
  });

  app.get("/forgot", (c) => {
    const deps = getDeps();
    return c.html(
      ForgotView({
        chrome: buildChrome(c, "/forgot"),
        captchaSiteKey: deps.captcha.siteKey,
        sent: false,
      }),
    );
  });

  app.post("/forgot", postBodyLimit, async (c) => {
    const deps = getDeps();
    const form = await readForm(c);
    const page = (sent: boolean, error?: "captcha" | "rate-limited", status: 200 | 400 | 429 = 200) =>
      c.html(
        ForgotView({
          chrome: buildChrome(c, "/forgot"),
          captchaSiteKey: deps.captcha.siteKey,
          sent,
          ...(error ? { error } : {}),
        }),
        status,
      );
    if (!(await captchaOk(deps, c, form))) return page(false, "captcha", 400);
    const res = await requestPasswordReset(
      deps,
      formString(form, "email").trim(),
      clientBucket(c, deps),
      pickRequestLocale(c),
    );
    if (!res.ok) return page(false, "rate-limited", 429);
    return page(true);
  });

  app.get("/reset/:token", async (c) => {
    const deps = getDeps();
    const token = c.req.param("token");
    const state = (await previewReset(deps, token)) ? "form" : "expired";
    return c.html(ResetView({ chrome: buildChrome(c, "/"), token, state }));
  });

  app.post("/reset/:token", postBodyLimit, async (c) => {
    const deps = getDeps();
    const token = c.req.param("token");
    const form = await readForm(c);
    const res = await completeReset(deps, token, formString(form, "password"));
    if (!res.ok) {
      const weak = res.error === "weak-password";
      return c.html(
        ResetView({
          chrome: buildChrome(c, "/"),
          token,
          state: weak ? "form" : "expired",
          ...(weak ? { error: "weak-password" as const } : {}),
        }),
        weak ? 400 : 410,
      );
    }
    await setOwnerSession(c, deps, res.value.user.id, res.value.epoch);
    return c.redirect("/dashboard");
  });

  app.get("/auth/google", async (c) => {
    const deps = getDeps();
    if (!deps.google.enabled) return c.notFound();
    const state = randomToken(16);
    const verifier = randomToken(32);
    const payload = JSON.stringify({ state, verifier });
    const signed = await signValue(payload, deps.env.SESSION_SECRET, OAUTH_TTL_SECONDS, deps.now());
    setCookie(c, OAUTH_COOKIE, signed, {
      httpOnly: true,
      secure: isHttpsApp(deps.env.APP_URL),
      sameSite: "Lax",
      path: "/auth/google",
      maxAge: OAUTH_TTL_SECONDS,
    });
    return c.redirect(deps.google.authorizeUrl({ state, codeChallenge: await challengeFor(verifier) }));
  });

  app.get("/auth/google/callback", async (c) => {
    const deps = getDeps();
    if (!deps.google.enabled) return c.notFound();
    const failure = () => c.redirect("/login?error=google");
    const raw = await verifyValue(getCookie(c, OAUTH_COOKIE), deps.env.SESSION_SECRET, deps.now());
    deleteCookie(c, OAUTH_COOKIE, { path: "/auth/google" });
    if (!raw) return failure();
    let saved: { state?: unknown; verifier?: unknown };
    try {
      saved = JSON.parse(raw);
    } catch {
      return failure();
    }
    const code = c.req.query("code");
    if (
      typeof saved.state !== "string" ||
      typeof saved.verifier !== "string" ||
      !code ||
      c.req.query("state") !== saved.state
    ) {
      return failure();
    }
    const profile = await deps.google.exchange({ code, codeVerifier: saved.verifier });
    if (!profile) return failure();
    const res = await signInWithGoogle(deps, profile, pickRequestLocale(c));
    if (!res.ok) return failure();
    await setOwnerSession(c, deps, res.value.user.id, res.value.epoch);
    return c.redirect("/dashboard");
  });

  return app;
}
