import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteSql, type SqliteSql } from "../src/adapters/sqlite.js";
import { createApp, MAX_FORM_BYTES, parseSafeBack } from "../src/app.js";
import type { Captcha, Deps, Env, GoogleAuth, GoogleProfile, Mail } from "../src/ports.js";

const APP_URL = "http://localhost:8787";
const PASSWORD = "old-owner-password-937";
const NEW_PASSWORD = "new-owner-password-684";
const OWNER = { name: "Nerea", email: "nerea@example.com", password: PASSWORD };
const GUEST = { firstName: "Clara", lastName: "Vega", email: "clara@example.com", pin: "1234" };
const OTHER_GUEST = { firstName: "Raul", lastName: "Soto", email: "raul@example.com", pin: "5678" };
const TEST_ENV: Env = {
  APP_URL,
  SESSION_SECRET: "test-session-secret-32-bytes-long!!",
  MAIL_FROM: "Cumplista <hola@cumplista.test>",
  MAIL_DRIVER: "console",
};

type RequestOptions = { jar?: CookieJar; headers?: Record<string, string> };

class CookieJar {
  private readonly store = new Map<string, string>();

  absorb(res: Response): void {
    for (const header of res.headers.getSetCookie()) {
      const first = header.split(";")[0] ?? "";
      const separator = first.indexOf("=");
      if (separator <= 0) continue;
      const name = first.slice(0, separator).trim();
      const value = first.slice(separator + 1).trim();
      if (value === "" || /max-age=0(?:;|$)/i.test(header)) this.store.delete(name);
      else this.store.set(name, value);
    }
  }

  header(): string {
    return Array.from(this.store, ([name, value]) => `${name}=${value}`).join("; ");
  }

  get(name: string): string {
    const value = this.store.get(name);
    if (value === undefined) throw new Error(`Missing cookie ${name}`);
    return value;
  }

  has(name: string): boolean {
    return this.store.has(name);
  }

  set(name: string, value: string): void {
    this.store.set(name, value);
  }
}

function capture(text: string, pattern: RegExp): string {
  const value = pattern.exec(text)?.[1];
  if (!value) throw new Error(`Expected ${pattern} in response`);
  return value;
}

function redirect(res: Response, path: string): void {
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe(path);
}

function itemIds(html: string): string[] {
  return Array.from(html.matchAll(/<li id="item-([^"]+)"/g), (match) => match[1] ?? "");
}

describe("Cumplista v2 HTTP behaviour", () => {
  let sql: SqliteSql;
  let app: ReturnType<typeof createApp>;
  let sentMails: Mail[];
  let shouldFailMail: boolean;
  let currentNow: Date;
  let captcha: Captcha;
  let captchaResult: boolean;
  let captchaCalls: { token: string; ip: string; result: boolean }[];
  let google: GoogleAuth;
  let googleProfile: GoogleProfile | null;
  let authorizationCalls: Parameters<GoogleAuth["authorizeUrl"]>[0][];
  let exchangeCalls: Parameters<GoogleAuth["exchange"]>[0][];

  beforeEach(() => {
    sql = createSqliteSql(":memory:");
    sentMails = [];
    shouldFailMail = false;
    currentNow = new Date("2026-11-12T10:00:00.000Z");
    captchaResult = true;
    captchaCalls = [];
    captcha = {
      siteKey: null,
      async verify(token, ip) {
        captchaCalls.push({ token, ip, result: captchaResult });
        return captchaResult;
      },
    };
    googleProfile = { sub: "google-profile-1", email: "google@example.com", emailVerified: true, name: "Google Owner" };
    authorizationCalls = [];
    exchangeCalls = [];
    google = {
      enabled: false,
      authorizeUrl(params) {
        authorizationCalls.push(params);
        return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
          state: params.state,
          code_challenge: params.codeChallenge,
        })}`;
      },
      async exchange(params) {
        exchangeCalls.push(params);
        return googleProfile;
      },
    };
    const deps: Deps = {
      sql,
      env: TEST_ENV,
      now: () => currentNow,
      clientIp: (req) => req.headers.get("x-test-client-ip") ?? "198.51.100.1",
      captcha,
      google,
      mailer: {
        async send(mail) {
          if (shouldFailMail) throw new Error("Simulated mail outage");
          sentMails.push(mail);
        },
      },
    };
    app = createApp(() => deps);
  });

  afterEach(() => sql.close());

  async function postForm(path: string, fields: Record<string, string> = {}, options: RequestOptions = {}): Promise<Response> {
    const headers = new Headers({ "content-type": "application/x-www-form-urlencoded", ...options.headers });
    if (options.jar) headers.set("cookie", options.jar.header());
    const res = await app.request(path, { method: "POST", headers, body: new URLSearchParams(fields).toString() });
    options.jar?.absorb(res);
    return res;
  }

  async function getPage(path: string, options: RequestOptions = {}): Promise<Response> {
    const headers = new Headers(options.headers);
    if (options.jar) headers.set("cookie", options.jar.header());
    const res = await app.request(path, { headers });
    options.jar?.absorb(res);
    return res;
  }

  async function signup(fields: Partial<typeof OWNER> = {}): Promise<CookieJar> {
    const jar = new CookieJar();
    redirect(await postForm("/signup", { ...OWNER, ...fields }, { jar }), "/dashboard");
    return jar;
  }

  async function createList(ownerJar: CookieJar, title = "Birthday wishes") {
    const res = await postForm("/lists", { title, locale: "en", occasionDate: "2026-11-22" }, { jar: ownerJar });
    expect(res.status).toBe(302);
    const listId = capture(res.headers.get("location") ?? "", /^\/o\/([A-Za-z0-9_-]+)$/);
    const ownerPath = `/o/${listId}`;
    const html = await (await getPage(ownerPath, { jar: ownerJar })).text();
    const token = capture(html, /http:\/\/localhost:8787\/i\/([A-Za-z0-9_-]{22,})/);
    return { listId, ownerPath, ownerJar, token, invitePath: `/i/${token}` };
  }

  async function setupList() {
    return createList(await signup());
  }

  async function addItem(list: { ownerPath: string; ownerJar: CookieJar }, name = "Fountain pen", fields: Record<string, string> = {}): Promise<string> {
    redirect(await postForm(`${list.ownerPath}/items`, { name, ...fields }, { jar: list.ownerJar }), list.ownerPath);
    const html = await (await getPage(list.ownerPath, { jar: list.ownerJar })).text();
    const id = itemIds(html).at(-1);
    if (!id) throw new Error("Expected item in owner page");
    return id;
  }

  async function register(list: { listId: string; invitePath: string }, fields: Partial<typeof GUEST> = {}): Promise<CookieJar> {
    const jar = new CookieJar();
    redirect(await postForm(`${list.invitePath}/register`, { ...GUEST, ...fields }, { jar }), `/l/${list.listId}/list`);
    return jar;
  }

  function resetPath(): string {
    const mail = sentMails.at(-1);
    if (!mail) throw new Error("Expected password reset mail");
    return capture(mail.text, /(\/reset\/[A-Za-z0-9_-]{43})/);
  }

  async function googleCallback(jar: CookieJar, stateOverride?: string): Promise<Response> {
    const start = await getPage("/auth/google", { jar });
    expect(start.status).toBe(302);
    const url = new URL(start.headers.get("location") ?? "");
    expect(url.origin).toBe("https://accounts.google.com");
    const state = url.searchParams.get("state");
    expect(state).toMatch(/^[A-Za-z0-9_-]{22,}$/);
    return getPage(`/auth/google/callback?${new URLSearchParams({ code: "authorization-code", state: stateOverride ?? state ?? "" })}`, { jar });
  }

  it("serves health and account links and sends signed-in owners to the dashboard", async () => {
    const health = await getPage("/healthz");
    expect(health.status).toBe(200);
    expect(await health.text()).toBe("ok");
    const landing = await getPage("/");
    expect(landing.status).toBe(200);
    const html = await landing.text();
    expect(html).toContain('href="/login"');
    expect(html).toContain("Log in");
    expect(html).toContain('href="/signup"');
    expect(html).toContain("Sign up");
    const jar = await signup();
    redirect(await getPage("/", { jar }), "/dashboard");
    redirect(await getPage("/signup", { jar }), "/dashboard");
  });

  it("signs up an owner with a cookie, normalizes email and never reflects the password", async () => {
    const jar = new CookieJar();
    const res = await postForm("/signup", { ...OWNER, email: " NEREA@EXAMPLE.COM " }, { jar });
    redirect(res, "/dashboard");
    expect(jar.has("cp_owner")).toBe(true);
    expect(await res.text()).not.toContain(PASSWORD);
    const dashboard = await getPage("/dashboard", { jar });
    expect(dashboard.status).toBe(200);
    expect(await dashboard.text()).toContain("Signed in as Nerea.");
    const login = await postForm("/login", { email: "nerea@example.com", password: PASSWORD }, { jar: new CookieJar() });
    redirect(login, "/dashboard");
    expect(await login.text()).not.toContain(PASSWORD);
    for (const path of ["/", "/signup", "/login", "/dashboard"]) {
      expect(await (await getPage(path, { jar })).text()).not.toContain(PASSWORD);
    }
    expect(sentMails).toHaveLength(0);
  });

  it("rejects duplicate normalized owner emails and passwords outside 10 to 200 characters", async () => {
    await signup();
    const duplicate = await postForm("/signup", { ...OWNER, email: "NEREA@EXAMPLE.COM" });
    expect(duplicate.status).toBe(400);
    expect(await duplicate.text()).toContain("An account with that email already exists. Log in instead.");
    for (const password of ["short937", "x".repeat(201)]) {
      const res = await postForm("/signup", { ...OWNER, email: "weak@example.com", password });
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("Use a password between 10 and 200 characters.");
      expect(html).not.toContain(password);
    }
  });

  it("returns identical owner login status and HTML for an unknown account and a wrong password", async () => {
    const fields = { email: OWNER.email, password: "wrong-password-826" };
    const unknown = await postForm("/login", fields);
    const unknownHtml = await unknown.text();
    await signup();
    const wrong = await postForm("/login", fields);
    expect([unknown.status, wrong.status]).toEqual([401, 401]);
    expect(await wrong.text()).toBe(unknownHtml);
    expect(unknownHtml).toContain("Wrong email or password.");
    expect(unknownHtml).not.toContain(fields.password);
  });

  it("throttles an owner email after ten wrong passwords even from a new client with the right password", async () => {
    await signup();
    for (let i = 0; i < 10; i++) {
      const res = await postForm("/login", { email: OWNER.email, password: "wrong-password" }, { headers: { "x-test-client-ip": `203.0.113.${i + 1}` } });
      expect(res.status).toBe(401);
    }
    const blocked = await postForm("/login", { email: "NEREA@EXAMPLE.COM", password: PASSWORD }, { headers: { "x-test-client-ip": "203.0.113.90" } });
    expect(blocked.status).toBe(429);
    expect(await blocked.text()).toContain("Too many attempts. Try again in a few minutes.");
    currentNow = new Date(currentNow.getTime() + 15 * 60 * 1000 + 1);
    redirect(await postForm("/login", { email: OWNER.email, password: PASSWORD }), "/dashboard");
  });

  it("logs an owner out by clearing the owner cookie", async () => {
    const jar = await signup();
    const logout = await postForm("/logout", {}, { jar });
    redirect(logout, "/");
    expect(logout.headers.get("set-cookie")).toContain("cp_owner=;");
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(jar.has("cp_owner")).toBe(false);
    redirect(await getPage("/dashboard", { jar }), "/login");
  });

  it("answers forgot-password identically for unknown and known emails and mails only the known account", async () => {
    await signup();
    const unknown = await postForm("/forgot", { email: "unknown@example.com" });
    expect(sentMails).toHaveLength(0);
    const known = await postForm("/forgot", { email: "NEREA@EXAMPLE.COM" });
    expect([unknown.status, known.status]).toEqual([200, 200]);
    expect(await known.text()).toBe(await unknown.text());
    expect(sentMails).toHaveLength(1);
    expect(sentMails[0]?.to).toBe("nerea@example.com");
    expect(sentMails[0]?.subject).toBe("Reset your Cumplista password");
    expect(sentMails[0]?.text).toContain(`${APP_URL}${resetPath()}`);
    expect(sentMails[0]?.text).not.toContain(PASSWORD);
  });

  it("consumes a reset token once, signs in with the new password and rejects pre-reset owner cookies", async () => {
    const oldJar = await signup();
    await postForm("/forgot", { email: OWNER.email });
    const path = resetPath();
    const preview = await getPage(path);
    expect(preview.status).toBe(200);
    expect(await preview.text()).toContain("Choose a new password");
    const weak = await postForm(path, { password: "short" });
    expect(weak.status).toBe(400);
    const jar = new CookieJar();
    const reset = await postForm(path, { password: NEW_PASSWORD }, { jar });
    redirect(reset, "/dashboard");
    expect(await reset.text()).not.toContain(NEW_PASSWORD);
    expect((await getPage("/dashboard", { jar })).status).toBe(200);
    redirect(await getPage("/dashboard", { jar: oldJar }), "/login");
    expect(oldJar.has("cp_owner")).toBe(false);
    const oldLogin = await postForm("/login", { email: OWNER.email, password: PASSWORD });
    expect(oldLogin.status).toBe(401);
    redirect(await postForm("/login", { email: OWNER.email, password: NEW_PASSWORD }), "/dashboard");
    const replay = await postForm(path, { password: "another-password-678" });
    expect(replay.status).toBe(410);
    expect(await replay.text()).toContain("This reset link has expired");
    expect(await (await getPage(path)).text()).toContain("This reset link has expired");
  });

  it("rejects reset tokens after 61 minutes without changing the password", async () => {
    await signup();
    await postForm("/forgot", { email: OWNER.email });
    const path = resetPath();
    currentNow = new Date(currentNow.getTime() + 61 * 60 * 1000);
    expect(await (await getPage(path)).text()).toContain("This reset link has expired");
    const res = await postForm(path, { password: NEW_PASSWORD });
    expect(res.status).toBe(410);
    expect(res.headers.has("set-cookie")).toBe(false);
    redirect(await postForm("/login", { email: OWNER.email, password: PASSWORD }), "/dashboard");
  });

  it("keeps forgot-password responses identical during a mail outage", async () => {
    await signup();
    shouldFailMail = true;
    const known = await postForm("/forgot", { email: OWNER.email });
    const unknown = await postForm("/forgot", { email: "missing@example.com" });
    expect([known.status, unknown.status]).toEqual([200, 200]);
    expect(await known.text()).toBe(await unknown.text());
    expect(sentMails).toHaveLength(0);
  });

  it("hides Google sign-in and returns 404 on both Google routes when disabled", async () => {
    expect((await getPage("/auth/google")).status).toBe(404);
    expect((await getPage("/auth/google/callback?code=abc&state=abc")).status).toBe(404);
    const html = await (await getPage("/login")).text();
    expect(html).not.toContain("Continue with Google");
    expect(html).not.toContain('href="/auth/google"');
    expect(authorizationCalls).toHaveLength(0);
    expect(exchangeCalls).toHaveLength(0);
  });

  it("rejects a Google state mismatch before exchanging the authorization code", async () => {
    google.enabled = true;
    expect(await (await getPage("/login")).text()).toContain("Continue with Google");
    const jar = new CookieJar();
    redirect(await googleCallback(jar, "wrong-state"), "/login?error=google");
    expect(exchangeCalls).toHaveLength(0);
    expect(jar.has("cp_owner")).toBe(false);
    expect(jar.has("cp_oauth")).toBe(false);
  });

  it("creates and signs in a Google account using a state cookie and PKCE", async () => {
    google.enabled = true;
    const jar = new CookieJar();
    redirect(await googleCallback(jar), "/dashboard");
    const call = exchangeCalls[0];
    expect(call?.code).toBe("authorization-code");
    expect(call?.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorizationCalls[0]?.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorizationCalls[0]?.codeChallenge).not.toBe(call?.codeVerifier);
    const dashboard = await getPage("/dashboard", { jar });
    expect(dashboard.status).toBe(200);
    expect(await dashboard.text()).toContain("Signed in as Google Owner.");
    await createList(jar, "Google birthday");
    const secondJar = new CookieJar();
    redirect(await googleCallback(secondJar), "/dashboard");
    expect(await (await getPage("/dashboard", { jar: secondJar })).text()).toContain("Google birthday");
  });

  it("links Google to the matching password account, preserves lists and evicts its password and old sessions", async () => {
    const oldJar = await signup();
    await createList(oldJar, "Preserved birthday");
    google.enabled = true;
    googleProfile = { sub: "linked-google", email: "NEREA@EXAMPLE.COM", emailVerified: true, name: "Verified Nerea" };
    const jar = new CookieJar();
    redirect(await googleCallback(jar), "/dashboard");
    expect(await (await getPage("/dashboard", { jar })).text()).toContain("Preserved birthday");
    redirect(await getPage("/dashboard", { jar: oldJar }), "/login");
    expect((await postForm("/login", { email: OWNER.email, password: PASSWORD })).status).toBe(401);
    await postForm("/forgot", { email: OWNER.email });
    redirect(await postForm(resetPath(), { password: NEW_PASSWORD }), "/dashboard");
    redirect(await postForm("/login", { email: OWNER.email, password: NEW_PASSWORD }), "/dashboard");
  });

  it("refuses Google profiles whose email is not verified", async () => {
    google.enabled = true;
    googleProfile = { sub: "unverified-google", email: "unverified@example.com", emailVerified: false, name: "Unverified" };
    const jar = new CookieJar();
    redirect(await googleCallback(jar), "/login?error=google");
    expect(jar.has("cp_owner")).toBe(false);
    redirect(await getPage("/dashboard", { jar }), "/login");
    await postForm("/forgot", { email: "unverified@example.com" });
    expect(sentMails).toHaveLength(0);
  });

  it("requires a valid Turnstile token for signup, registration and forgot but never for login", async () => {
    const list = await setupList();
    captcha.siteKey = "test-site-key";
    const cases = [
      { path: "/signup", fields: { ...OWNER, email: "captcha@example.com" }, success: 302 },
      { path: `${list.invitePath}/register`, fields: { ...GUEST }, success: 302 },
      { path: "/forgot", fields: { email: OWNER.email }, success: 200 },
    ];
    for (const entry of cases) {
      const before = captchaCalls.length;
      const missing = await postForm(entry.path, entry.fields);
      expect(missing.status).toBe(400);
      expect(await missing.text()).toContain("Complete the security check and try again.");
      expect(captchaCalls).toHaveLength(before);
      captchaResult = false;
      const failed = await postForm(entry.path, { ...entry.fields, "cf-turnstile-response": "invalid-token" });
      expect(failed.status).toBe(400);
      expect(captchaCalls.at(-1)).toEqual({ token: "invalid-token", ip: "198.51.100.1", result: false });
      captchaResult = true;
      const passed = await postForm(entry.path, { ...entry.fields, "cf-turnstile-response": "valid-token" }, { headers: { "x-test-client-ip": "203.0.113.77" } });
      expect(passed.status).toBe(entry.success);
      expect(captchaCalls.at(-1)).toEqual({ token: "valid-token", ip: "203.0.113.77", result: true });
    }
    const checked = captchaCalls.length;
    captchaResult = false;
    redirect(await postForm("/login", { email: OWNER.email, password: PASSWORD }), "/dashboard");
    redirect(await postForm(`${list.invitePath}/login`, { email: GUEST.email, pin: GUEST.pin }), `/l/${list.listId}/list`);
    redirect(await postForm(`/l/${list.listId}/login`, { email: GUEST.email, pin: GUEST.pin }), `/l/${list.listId}/list`);
    expect(captchaCalls).toHaveLength(checked);
    for (const path of ["/signup", "/forgot", list.invitePath]) {
      const html = await (await getPage(path)).text();
      expect(html).toContain("https://challenges.cloudflare.com/turnstile/v0/api.js");
      expect(html).toContain('data-sitekey="test-site-key"');
    }
    expect(await (await getPage("/login")).text()).not.toContain("turnstile/v0/api.js");
  });

  it("skips Turnstile verification and its script everywhere when no site key is configured", async () => {
    captchaResult = false;
    const list = await setupList();
    await register(list);
    expect((await postForm("/forgot", { email: OWNER.email })).status).toBe(200);
    for (const path of ["/", "/signup", "/login", "/forgot", list.invitePath, `/l/${list.listId}`]) {
      const html = await (await getPage(path)).text();
      expect(html).not.toContain("challenges.cloudflare.com");
      expect(html).not.toContain("cf-turnstile");
    }
    expect(captchaCalls).toHaveLength(0);
  });

  it("creates a list visible on the dashboard with its date and invite link", async () => {
    const list = await setupList();
    const dashboard = await getPage("/dashboard", { jar: list.ownerJar });
    expect(dashboard.status).toBe(200);
    const html = await dashboard.text();
    expect(html).toContain("Birthday wishes");
    expect(html).toContain(`href="${list.ownerPath}"`);
    const owner = await getPage(list.ownerPath, { jar: list.ownerJar });
    expect(owner.status).toBe(200);
    const ownerHtml = await owner.text();
    expect(ownerHtml).toContain("10 days left");
    expect(ownerHtml).toContain(`${APP_URL}${list.invitePath}`);
    expect(sentMails).toHaveLength(0);
    for (const fields of [{ title: "", occasionDate: "" }, { title: "Invalid date", occasionDate: "2026-02-30" }]) {
      expect((await postForm("/lists", fields, { jar: list.ownerJar })).status).toBe(400);
    }
  });

  it("limits list creation to twenty per day per owner while allowing another owner to create", async () => {
    const jar = await signup();
    for (let i = 0; i < 20; i++) {
      expect((await postForm("/lists", { title: `Birthday ${i}` }, { jar })).status).toBe(302);
    }
    const blocked = await postForm("/lists", { title: "Birthday 21" }, { jar, headers: { "x-test-client-ip": "203.0.113.7" } });
    expect(blocked.status).toBe(429);
    expect(await blocked.text()).toContain("Too many requests. Try again in a while.");
    const other = await signup({ email: "other-owner@example.com" });
    await createList(other, "Other owner's birthday");
    currentNow = new Date(currentNow.getTime() + 24 * 60 * 60 * 1000 + 1);
    expect((await postForm("/lists", { title: "Next day" }, { jar })).status).toBe(302);
  });

  it("returns 404 to another owner on list management and every item mutation", async () => {
    const list = await setupList();
    const item = await addItem(list);
    const other = await signup({ email: "other-owner@example.com" });
    expect((await getPage(list.ownerPath, { jar: other })).status).toBe(404);
    for (const [path, fields] of [
      [`${list.ownerPath}/items`, { name: "Intruder" }],
      [`${list.ownerPath}/items/${item}`, { name: "Hijacked" }],
      [`${list.ownerPath}/items/${item}/delete`, {}],
      [`${list.ownerPath}/items/${item}/received`, { received: "1" }],
      [`${list.ownerPath}/items/${item}/move`, { direction: "up" }],
      [`${list.ownerPath}/invite`, {}],
      [`${list.ownerPath}/delete`, {}],
    ] satisfies [string, Record<string, string>][]) {
      expect((await postForm(path, fields, { jar: other })).status, path).toBe(404);
    }
    const html = await (await getPage(list.ownerPath, { jar: list.ownerJar })).text();
    expect(html).toContain("Fountain pen");
    expect(html).not.toContain("Intruder");
    expect(html).not.toContain("Hijacked");
    expect(itemIds(html)).toEqual([item]);
  });

  it("regenerates the generic invite while existing guests retain access and can sign in", async () => {
    const list = await setupList();
    const guest = await register(list);
    redirect(await postForm(`${list.ownerPath}/invite`, {}, { jar: list.ownerJar }), `${list.ownerPath}?flash=invite-regenerated`);
    const html = await (await getPage(list.ownerPath, { jar: list.ownerJar })).text();
    const newToken = capture(html, /http:\/\/localhost:8787\/i\/([A-Za-z0-9_-]{22,})/);
    expect(newToken).not.toBe(list.token);
    expect((await getPage(list.invitePath)).status).toBe(404);
    expect((await postForm(`${list.invitePath}/register`, OTHER_GUEST)).status).toBe(404);
    expect((await getPage(`/i/${newToken}`)).status).toBe(200);
    expect((await getPage(`/l/${list.listId}/list`, { jar: guest })).status).toBe(200);
    redirect(await postForm(`/l/${list.listId}/login`, { email: GUEST.email, pin: GUEST.pin }, { jar: new CookieJar() }), `/l/${list.listId}/list`);
  });

  it("deletes a list and cascades its items, guest accounts, claims and side gifts", async () => {
    const list = await setupList();
    const item = await addItem(list);
    const guest = await register(list);
    const guestPath = `/l/${list.listId}`;
    expect((await postForm(`${guestPath}/items/${item}/claim`, {}, { jar: guest })).status).toBe(302);
    expect((await postForm(`${guestPath}/ideas`, { name: "Cascade gift" }, { jar: guest })).status).toBe(302);
    for (const table of ["lists", "items", "guests", "claims", "side_gifts"]) {
      expect(await sql.first(`SELECT COUNT(*) AS count FROM ${table}`)).toEqual({ count: 1 });
    }
    redirect(await postForm(`${list.ownerPath}/delete`, {}, { jar: list.ownerJar }), "/dashboard?flash=deleted");
    for (const table of ["lists", "items", "guests", "claims", "side_gifts"]) {
      expect(await sql.first(`SELECT COUNT(*) AS count FROM ${table}`)).toEqual({ count: 0 });
    }
    expect((await getPage(list.ownerPath, { jar: list.ownerJar })).status).toBe(404);
    expect((await getPage(list.invitePath)).status).toBe(404);
    expect((await getPage(`${guestPath}/list`, { jar: guest })).status).toBe(404);
    expect(await (await getPage("/dashboard", { jar: list.ownerJar })).text()).not.toContain("Birthday wishes");
  });

  it("adds, edits, reorders, marks received and deletes items with literal prices and totals", async () => {
    const list = await setupList();
    const mug = await addItem(list, "Ceramic mug", { price: "24.50", url: "https://shop.example.com/mug", details: "Speckled glaze" });
    const scarf = await addItem(list, "Wool scarf", { price: "35,49" });
    const novel = await addItem(list, "Hardcover novel", { price: "18" });
    const page = () => getPage(list.ownerPath, { jar: list.ownerJar });
    const initial = await (await page()).text();
    expect(initial).toContain("$77.99");
    expect(initial).toContain('href="https://shop.example.com/mug"');
    expect(initial).toContain('rel="noopener noreferrer nofollow"');
    expect(initial).toContain('target="_blank"');
    expect(itemIds(initial)).toEqual([mug, scarf, novel]);
    redirect(await postForm(`${list.ownerPath}/items/${novel}/move`, { direction: "up" }, { jar: list.ownerJar }), `${list.ownerPath}#item-${novel}`);
    expect(itemIds(await (await page()).text())).toEqual([mug, novel, scarf]);
    expect((await postForm(`${list.ownerPath}/items/${mug}/move`, { direction: "down" }, { jar: list.ownerJar })).status).toBe(302);
    expect(itemIds(await (await page()).text())).toEqual([novel, mug, scarf]);
    redirect(await postForm(`${list.ownerPath}/items/${mug}`, { name: "Handmade ceramic mug", price: "30.00", url: "https://shop.example.com/handmade-mug", details: "Cobalt blue" }, { jar: list.ownerJar }), `${list.ownerPath}#item-${mug}`);
    expect((await postForm(`${list.ownerPath}/items/${mug}/received`, { received: "1" }, { jar: list.ownerJar })).status).toBe(302);
    expect(await (await page()).text()).toContain("Received");
    expect((await postForm(`${list.ownerPath}/items/${mug}/received`, { received: "0" }, { jar: list.ownerJar })).status).toBe(302);
    expect(await (await page()).text()).not.toContain('class="checklist-row is-received"');
    redirect(await postForm(`${list.ownerPath}/items/${scarf}/delete`, {}, { jar: list.ownerJar }), list.ownerPath);
    const final = await (await page()).text();
    expect(final).toContain("Handmade ceramic mug");
    expect(final).toContain("Cobalt blue");
    expect(final).toContain("$48.00");
    expect(final).not.toContain("Wool scarf");
    expect(itemIds(final)).toEqual([novel, mug]);
  });

  it("rejects invalid item names, prices, URL schemes, notes and action values without changing the item", async () => {
    const list = await setupList();
    const item = await addItem(list);
    for (const fields of [
      { name: "" }, { name: "x".repeat(121) }, { price: "-12.00" }, { price: "1.234" },
      { price: "1e3" }, { price: "NaN" }, { price: "10000000" },
      { url: "javascript:alert(1)" }, { url: "data:text/html,test" }, { url: "ftp://shop.example.com/item" },
      { url: "not a URL" }, { details: "x".repeat(1001) },
    ]) {
      for (const path of [`${list.ownerPath}/items`, `${list.ownerPath}/items/${item}`]) {
        const res = await postForm(path, { name: "Invalid draft", ...fields }, { jar: list.ownerJar });
        expect(res.status, JSON.stringify(fields)).toBe(400);
        expect(await res.text()).toContain("Check the highlighted fields and try again.");
      }
    }
    expect((await postForm(`${list.ownerPath}/items/${item}/move`, { direction: "sideways" }, { jar: list.ownerJar })).status).toBe(400);
    expect((await postForm(`${list.ownerPath}/items/${item}/received`, { received: "maybe" }, { jar: list.ownerJar })).status).toBe(400);
    const html = await (await getPage(list.ownerPath, { jar: list.ownerJar })).text();
    expect(itemIds(html)).toEqual([item]);
    expect(html).toContain("Fountain pen");
    expect(html).not.toContain("Invalid draft");
  });

  it("shows the generic invite and both forms, registers a guest and rejects duplicate normalized emails", async () => {
    const list = await setupList();
    const invite = await getPage(list.invitePath);
    expect(invite.status).toBe(200);
    const html = await invite.text();
    expect(html).toContain("Birthday wishes");
    expect(html).toContain("Nerea invited you");
    expect(html).toContain(`action="${list.invitePath}/register"`);
    expect(html).toContain(`action="${list.invitePath}/login"`);
    for (const field of ["firstName", "lastName", "email", "pin"]) expect(html).toContain(`name="${field}"`);
    const guest = await register(list, { firstName: " Clara ", lastName: " Vega ", email: " CLARA@EXAMPLE.COM " });
    const page = await getPage(`/l/${list.listId}/list`, { jar: guest });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Clara Vega");
    const duplicate = await postForm(`${list.invitePath}/register`, GUEST);
    expect(duplicate.status).toBe(409);
    expect(await duplicate.text()).toContain("You already joined this list with that email. Sign in below with your 4-digit PIN.");
  });

  it("requires exactly four ASCII digits for guest PINs", async () => {
    const list = await setupList();
    for (const pin of ["", "123", "12345", "12a4", "１２３４", " 1234", "1234\n"]) {
      const res = await postForm(`${list.invitePath}/register`, { ...GUEST, pin });
      expect(res.status, JSON.stringify(pin)).toBe(400);
      expect(await res.text()).toContain("Check the highlighted fields and try again.");
    }
    const guest = await register(list, { pin: "0000" });
    expect((await getPage(`/l/${list.listId}/list`, { jar: guest })).status).toBe(200);
  });

  it("signs a registered guest in from fresh clients at both login URLs and clears its cookie on logout", async () => {
    const list = await setupList();
    await register(list);
    for (const path of [`${list.invitePath}/login`, `/l/${list.listId}/login`]) {
      const jar = new CookieJar();
      redirect(await postForm(path, { email: "CLARA@EXAMPLE.COM", pin: GUEST.pin }, { jar }), `/l/${list.listId}/list`);
      expect((await getPage(`/l/${list.listId}/list`, { jar })).status).toBe(200);
      redirect(await getPage(list.invitePath, { jar }), `/l/${list.listId}/list`);
      redirect(await postForm(`/l/${list.listId}/logout`, {}, { jar }), `/l/${list.listId}`);
      expect(jar.has(`cp_g_${list.listId}`)).toBe(false);
      redirect(await getPage(`/l/${list.listId}/list`, { jar }), `/l/${list.listId}`);
    }
  });

  it("returns identical guest login status and HTML for an unknown email and a wrong PIN", async () => {
    const list = await setupList();
    for (const [path, email] of [
      [`${list.invitePath}/login`, "unknown-invite@example.com"],
      [`/l/${list.listId}/login`, "unknown-list@example.com"],
    ] satisfies [string, string][]) {
      const fields = { email, pin: "9999" };
      const unknown = await postForm(path, fields);
      await register(list, { email });
      const wrong = await postForm(path, fields);
      expect([unknown.status, wrong.status]).toEqual([401, 401]);
      expect(await wrong.text()).toBe(await unknown.text());
    }
  });

  it("throttles a guest email after eight wrong PINs even with a correct PIN from another client", async () => {
    const list = await setupList();
    await register(list);
    for (let i = 0; i < 8; i++) {
      expect((await postForm(`/l/${list.listId}/login`, { email: GUEST.email, pin: "9999" }, { headers: { "x-test-client-ip": `203.0.113.${i + 1}` } })).status).toBe(401);
    }
    const blocked = await postForm(`${list.invitePath}/login`, { email: "CLARA@EXAMPLE.COM", pin: GUEST.pin }, { headers: { "x-test-client-ip": "203.0.113.99" } });
    expect(blocked.status).toBe(429);
    expect(await blocked.text()).toContain("Too many attempts. Try again in a few minutes.");
    currentNow = new Date(currentNow.getTime() + 15 * 60 * 1000 + 1);
    redirect(await postForm(`/l/${list.listId}/login`, { email: GUEST.email, pin: GUEST.pin }), `/l/${list.listId}/list`);
  });

  it("atomically limits forty concurrent wrong PINs to eight 401s and thirty-two 429s without blocking another guest", async () => {
    const list = await setupList();
    await register(list);
    await register(list, OTHER_GUEST);
    const responses = await Promise.all(Array.from({ length: 40 }, () => postForm(`/l/${list.listId}/login`, { email: GUEST.email, pin: "9999" })));
    expect(responses.filter((res) => res.status === 401)).toHaveLength(8);
    expect(responses.filter((res) => res.status === 429)).toHaveLength(32);
    const otherJar = new CookieJar();
    redirect(await postForm(`/l/${list.listId}/login`, { email: OTHER_GUEST.email, pin: OTHER_GUEST.pin }, { jar: otherJar, headers: { "x-test-client-ip": "203.0.113.88" } }), `/l/${list.listId}/list`);
    expect((await getPage(`/l/${list.listId}/list`, { jar: otherJar })).status).toBe(200);
  });

  it("refuses the 201st guest with the full-list error", async () => {
    const list = await setupList();
    await sql.batch(Array.from({ length: 200 }, (_, i) => ({
      sql: "INSERT INTO guests (id, list_id, first_name, last_name, email, pin_hash, session_nonce, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      params: [`seed_${i}`, list.listId, "Seed", `Guest${i}`, `seed${i}@example.com`, "unused-seeded-hash", `seed_nonce_${String(i).padStart(22, "0")}`, currentNow.toISOString()],
    })));
    const res = await postForm(`${list.invitePath}/register`, GUEST);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("This gift list has reached its guest limit.");
    expect(res.headers.has("set-cookie")).toBe(false);
    expect(await sql.first("SELECT COUNT(*) AS count FROM guests WHERE list_id = ?", list.listId)).toEqual({ count: 200 });
  });

  it("rejects list A guest cookies on list B and guest cookies replayed as owner cookies", async () => {
    const a = await setupList();
    const b = await createList(a.ownerJar, "Another birthday");
    const guest = await register(a);
    const value = guest.get(`cp_g_${a.listId}`);
    redirect(await getPage(`/l/${b.listId}/list`, { jar: guest }), `/l/${b.listId}`);
    const forgedList = new CookieJar();
    forgedList.set(`cp_g_${b.listId}`, value);
    redirect(await getPage(`/l/${b.listId}/list`, { jar: forgedList }), `/l/${b.listId}`);
    const forgedOwner = new CookieJar();
    forgedOwner.set("cp_owner", value);
    redirect(await getPage(a.ownerPath, { jar: forgedOwner }), "/login");
    redirect(await getPage("/dashboard", { jar: forgedOwner }), "/login");
  });

  it("claims and releases only the current guest's claims and shows the claimer's full name to others", async () => {
    const list = await setupList();
    const item = await addItem(list);
    const a = await register(list);
    const b = await register(list, OTHER_GUEST);
    const path = `/l/${list.listId}`;
    redirect(await postForm(`${path}/items/${item}/claim`, {}, { jar: a }), `${path}/list#item-${item}`);
    const taken = await (await getPage(`${path}/list`, { jar: b })).text();
    expect(taken).toContain("Clara Vega");
    expect(taken).toContain("wrapped gift claimed by Clara Vega");
    expect((await postForm(`${path}/items/${item}/claim`, {}, { jar: b })).status).toBe(409);
    redirect(await postForm(`${path}/items/${item}/unclaim`, {}, { jar: b }), `${path}/list#item-${item}`);
    expect(await (await getPage(`${path}/list`, { jar: b })).text()).toContain("wrapped gift claimed by Clara Vega");
    redirect(await postForm(`${path}/items/${item}/unclaim`, {}, { jar: a }), `${path}/list#item-${item}`);
    expect(await (await getPage(`${path}/list`, { jar: b })).text()).not.toContain("wrapped gift claimed by Clara Vega");
    redirect(await postForm(`${path}/items/${item}/claim`, {}, { jar: b }), `${path}/list#item-${item}`);
  });

  it("allows exactly one winner in a concurrent double claim", async () => {
    const list = await setupList();
    const item = await addItem(list);
    const a = await register(list);
    const b = await register(list, OTHER_GUEST);
    const results = await Promise.all([a, b].map((jar) => postForm(`/l/${list.listId}/items/${item}/claim`, {}, { jar })));
    expect(results.map((res) => res.status).sort()).toEqual([302, 409]);
    const loser = results.find((res) => res.status === 409);
    expect(await loser?.text()).toContain("Someone else just took that gift.");
  });

  it("prevents claiming and releasing received items", async () => {
    const list = await setupList();
    const free = await addItem(list, "Desk lamp");
    const claimed = await addItem(list, "Board game");
    const jar = await register(list);
    const base = `/l/${list.listId}`;
    expect((await postForm(`${base}/items/${claimed}/claim`, {}, { jar })).status).toBe(302);
    for (const item of [free, claimed]) {
      expect((await postForm(`${list.ownerPath}/items/${item}/received`, { received: "1" }, { jar: list.ownerJar })).status).toBe(302);
      expect((await postForm(`${base}/items/${item}/claim`, {}, { jar })).status).toBe(409);
      expect((await postForm(`${base}/items/${item}/unclaim`, {}, { jar })).status).toBe(409);
    }
    expect(await (await getPage(`${base}/list`, { jar })).text()).toContain("Received");
  });

  it("lets guests create, edit and delete only their own ideas and caps each guest at fifty", async () => {
    const list = await setupList();
    const a = await register(list);
    const b = await register(list, OTHER_GUEST);
    const base = `/l/${list.listId}`;
    const created = await postForm(`${base}/ideas`, { name: "Secret headphones", price: "85.00", url: "https://shop.example.com/headphones", details: "Wireless" }, { jar: a });
    expect(created.status).toBe(302);
    const id = capture(created.headers.get("location") ?? "", /#idea-([A-Za-z0-9_-]+)$/);
    const otherHtml = await (await getPage(`${base}/list`, { jar: b })).text();
    expect(otherHtml).toContain("Secret headphones");
    expect(otherHtml).toContain("Clara Vega");
    expect(otherHtml).not.toContain(`action="${base}/ideas/${id}/delete"`);
    expect((await postForm(`${base}/ideas/${id}`, { name: "Hijacked" }, { jar: b })).status).toBe(404);
    expect((await postForm(`${base}/ideas/${id}/delete`, {}, { jar: b })).status).toBe(404);
    redirect(await postForm(`${base}/ideas/${id}`, { name: "Secret deluxe headphones", price: "110.00", details: "Blue" }, { jar: a }), `${base}/list#idea-${id}`);
    const updated = await (await getPage(`${base}/list`, { jar: b })).text();
    expect(updated).toContain("Secret deluxe headphones");
    expect(updated).toContain("$110.00");
    expect(updated).toContain("Blue");
    for (let i = 1; i < 50; i++) {
      expect((await postForm(`${base}/ideas`, { name: `Extra idea ${i}` }, { jar: a })).status).toBe(302);
    }
    const capped = await postForm(`${base}/ideas`, { name: "Idea 51" }, { jar: a });
    expect(capped.status).toBe(400);
    expect(await capped.text()).not.toContain("Idea 51");
    expect((await postForm(`${base}/ideas`, { name: "Other guest's first idea" }, { jar: b })).status).toBe(302);
    redirect(await postForm(`${base}/ideas/${id}/delete`, {}, { jar: a }), `${base}/list`);
    expect(await (await getPage(`${base}/list`, { jar: b })).text()).not.toContain("Secret deluxe headphones");
    expect((await postForm(`${base}/ideas`, { name: "Replacement idea" }, { jar: a })).status).toBe(302);
  });

  it("PRIVACY INVARIANT: no owner page, mutation response or redirect exposes guest identities, claims, ideas or counts", async () => {
    const list = await setupList();
    const pen = await addItem(list);
    const organizer = await addItem(list, "Desk organizer");
    const first = { firstName: "XiomaraUnique", lastName: "VelazquezSecret", email: "xiomara-unique@example.com", pin: "1234" };
    const second = { firstName: "BasilioDistinct", lastName: "MontenegroHidden", email: "basilio-distinct@example.com", pin: "5678" };
    const a = await register(list, first);
    const b = await register(list, second);
    const guestPath = `/l/${list.listId}`;
    expect((await postForm(`${guestPath}/items/${pen}/claim`, {}, { jar: a })).status).toBe(302);
    expect((await postForm(`${guestPath}/ideas`, { name: "SecretOrchid73942", price: "739.42", details: "HiddenSurpriseNotes" }, { jar: b })).status).toBe(302);
    const guestHtml = await (await getPage(`${guestPath}/list`, { jar: b })).text();
    expect(guestHtml).toContain("XiomaraUnique VelazquezSecret");
    expect(guestHtml).toContain("SecretOrchid73942");
    const forbidden = [first.firstName, first.lastName, first.email, second.firstName, second.lastName, second.email,
      "SecretOrchid73942", "HiddenSurpriseNotes", "739.42", "claimed by", 'data-state="taken"',
      'data-state="mine"', "is-wrapped", "gift-tag", "tag-claimed", "guest-count", "guestCount", "2 guests", "2 guest", "Guests (2)"];
    const assertPrivate = async (response: Response): Promise<void> => {
      let res = response;
      for (let depth = 0; depth < 5; depth++) {
        const location = res.headers.get("location") ?? "";
        const output = `${location}\n${await res.text()}`;
        for (const value of forbidden) expect(output, value).not.toContain(value);
        expect(output).not.toMatch(/\b(?:guests?|registered|attendees)\s*(?:count|:|\()\s*2\b|\b2\s+(?:registered guests?|attendees)\b/i);
        if (res.status !== 302) {
          expect([200, 400]).toContain(res.status);
          return;
        }
        expect(location).toMatch(/^\/(?:dashboard|o\/|login|$)/);
        res = await getPage(location, { jar: list.ownerJar });
      }
      throw new Error("Owner redirect did not terminate");
    };
    for (const path of ["/", "/signup", "/login", "/dashboard", ...["created", "deleted", "invalid", "cap-reached", "rate-limited"].map((flash) => `/dashboard?flash=${flash}`),
      list.ownerPath, ...["invite-regenerated", "invalid", "guest-added", "already-taken"].map((flash) => `${list.ownerPath}?flash=${flash}`)]) {
      await assertPrivate(await getPage(path, { jar: list.ownerJar }));
    }
    for (const [path, fields] of [
      [`${list.ownerPath}/items`, { name: "", price: "bad" }],
      [`${list.ownerPath}/items`, { name: "Tea kettle", price: "28.00" }],
      [`${list.ownerPath}/items/${pen}`, { name: "Gold fountain pen", price: "58.00" }],
      [`${list.ownerPath}/items/${pen}/move`, { direction: "down" }],
      [`${list.ownerPath}/items/${pen}/received`, { received: "1" }],
      [`${list.ownerPath}/items/${organizer}/delete`, {}],
      [`${list.ownerPath}/invite`, {}],
      ["/lists", { title: "Another birthday" }],
      [`${list.ownerPath}/delete`, {}],
      ["/logout", {}],
    ] satisfies [string, Record<string, string>][]) await assertPrivate(await postForm(path, fields, { jar: list.ownerJar }));
  });

  it("STATIC PRIVACY: owner modules contain no guests, claims or side_gifts references or guest-domain imports", () => {
    for (const path of ["domain/lists.ts", "domain/users.ts", "domain/invite.ts", "domain/password.ts", "routes/owner.ts", "routes/account.ts"]) {
      const source = readFileSync(fileURLToPath(new URL(`../src/${path}`, import.meta.url)), "utf8");
      expect(source, path).not.toMatch(/\b(?:guests|claims|side_gifts)\b/);
    }
    const owner = readFileSync(fileURLToPath(new URL("../src/routes/owner.ts", import.meta.url)), "utf8");
    expect(owner).not.toMatch(/(?:from\s*|import\s*\()\s*["']\.\.\/domain\/(?:guests|claims|ideas)(?:\.js)?["']/);
  });

  it("sets both session cookies for 365 days with HttpOnly, SameSite=Lax and root path", async () => {
    const jar = new CookieJar();
    const owner = await postForm("/signup", OWNER, { jar });
    redirect(owner, "/dashboard");
    const list = await createList(jar);
    const guest = await postForm(`${list.invitePath}/register`, GUEST);
    redirect(guest, `/l/${list.listId}/list`);
    for (const [res, name] of [[owner, "cp_owner"], [guest, `cp_g_${list.listId}`]] satisfies [Response, string][]) {
      const header = res.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
      expect(header).toContain("Max-Age=31536000");
      expect(header).toContain("HttpOnly");
      expect(header).toContain("SameSite=Lax");
      expect(header).toContain("Path=/");
    }
  });

  it("rejects foreign and null Origin on every POST route family before any mutation", async () => {
    const list = await setupList();
    const item = await addItem(list);
    const guest = await register(list);
    const idea = await postForm(`/l/${list.listId}/ideas`, { name: "Protected idea" }, { jar: guest });
    const id = capture(idea.headers.get("location") ?? "", /#idea-([A-Za-z0-9_-]+)$/);
    const paths = ["/signup", "/login", "/logout", "/forgot", "/reset/token", "/lang", "/lists", list.ownerPath + "/invite", list.ownerPath + "/delete",
      `${list.ownerPath}/items`, `${list.ownerPath}/items/${item}`, ...["delete", "received", "move"].map((action) => `${list.ownerPath}/items/${item}/${action}`),
      `${list.invitePath}/register`, `${list.invitePath}/login`, `/l/${list.listId}/login`, `/l/${list.listId}/logout`,
      `/l/${list.listId}/items/${item}/claim`, `/l/${list.listId}/items/${item}/unclaim`,
      `/l/${list.listId}/ideas`, `/l/${list.listId}/ideas/${id}`, `/l/${list.listId}/ideas/${id}/delete`];
    for (const origin of ["https://evil.example", "null"]) {
      for (const path of paths) {
        const res = await postForm(path, { name: "Hijacked", email: OWNER.email, password: PASSWORD }, { jar: list.ownerJar, headers: { origin } });
        expect(res.status, `${origin} ${path}`).toBe(403);
        expect(await res.text()).toBe("Forbidden");
      }
    }
    const sameOrigin = await postForm("/lists", { title: "Allowed origin" }, { jar: list.ownerJar, headers: { origin: APP_URL } });
    expect(sameOrigin.status).toBe(302);
    expect((await getPage(list.ownerPath, { jar: list.ownerJar })).status).toBe(200);
  });

  it("allows only local dashboard, invite and list return paths and rejects open redirect bypasses", async () => {
    const token = "abcdefghijklmnopqrstuv";
    const safe = ["/", "/dashboard", "/dashboard?flash=created", "/o/abc_123-XYZ", "/o/abc_123?flash=invite-regenerated", "/l/abc_123", "/l/abc_123/list", "/l/abc_123/list?flash=already-taken", `/i/${token}`, `/i/${token}?flash=invalid`];
    const unsafe = ["/.//evil.com", "/.//evil.com/phish", "/..//evil.com", "/%2e%2e//evil.com", "/a/..//evil.com", "/\t/evil.example", "/o/abc\t", "//evil.example", "/\\evil.example", "/o/abc\\list", "/o/abc?x=1", "/o/abc?flash=UPPER", "/other/abc", "https://evil.example", "/dashboard/../evil", `/i/${token}/register`, "/i/short", `/i/${token}?next=//evil.example`, "/dashboard?flash=created&next=//evil.example", "/dashboard\r\nLocation: https://evil.example"];
    for (const path of safe) {
      expect(parseSafeBack(path)).toBe(path);
      redirect(await postForm("/lang", { lang: "es", back: path }), path);
    }
    for (const path of unsafe) {
      expect(parseSafeBack(path), JSON.stringify(path)).toBe("/");
      redirect(await postForm("/lang", { lang: "es", back: path }), "/");
    }
  });

  it("rejects POST bodies over 16 KB across route families and rejects non-urlencoded forms", async () => {
    const list = await setupList();
    const item = await addItem(list);
    const guest = await register(list);
    const idea = await postForm(`/l/${list.listId}/ideas`, { name: "Body limits" }, { jar: guest });
    const id = capture(idea.headers.get("location") ?? "", /#idea-([A-Za-z0-9_-]+)$/);
    const ownerPaths = ["/lists", `${list.ownerPath}/items`, `${list.ownerPath}/items/${item}`, `${list.ownerPath}/items/${item}/delete`, `${list.ownerPath}/items/${item}/received`, `${list.ownerPath}/items/${item}/move`, `${list.ownerPath}/invite`, `${list.ownerPath}/delete`];
    const publicPaths = ["/signup", "/login", "/logout", "/forgot", "/reset/token", "/lang", `${list.invitePath}/register`, `${list.invitePath}/login`, `/l/${list.listId}/login`, `/l/${list.listId}/logout`];
    const guestPaths = [`/l/${list.listId}/ideas`, `/l/${list.listId}/ideas/${id}`, `/l/${list.listId}/ideas/${id}/delete`, `/l/${list.listId}/items/${item}/claim`, `/l/${list.listId}/items/${item}/unclaim`];
    for (const path of [...publicPaths, ...ownerPaths, ...guestPaths]) {
      const res = await app.request(path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `x=${"a".repeat(16 * 1024 + 1)}` });
      expect(res.status, path).toBe(413);
    }
    expect(MAX_FORM_BYTES).toBe(16384);
    const declared = await app.request(`${list.ownerPath}/items/${item}/delete`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "content-length": "16385" }, body: "x" });
    expect(declared.status).toBe(413);
    for (const path of [...publicPaths.filter((path) => !path.endsWith("logout")), ...ownerPaths.filter((path) => !/\/(?:delete|invite)$/.test(path)), ...guestPaths.slice(0, 2)]) {
      const jar = path.startsWith("/l/") ? guest : list.ownerJar;
      for (const contentType of ["application/json", "text/plain"]) {
        const res = await app.request(path, { method: "POST", headers: { "content-type": contentType, cookie: jar.header() }, body: "{}" });
        expect(res.status, `${path} ${contentType}`).toBe(415);
      }
    }
    const multipart = new FormData();
    multipart.set("email", OWNER.email);
    expect((await app.request("/signup", { method: "POST", body: multipart })).status).toBe(415);
  });

  it("uses Accept-Language and the locale cookie and keeps the invite path when switching language", async () => {
    const spanish = await getPage("/signup", { headers: { "accept-language": "es-ES,es;q=0.9,en;q=0.8" } });
    const html = await spanish.text();
    expect(html).toContain('lang="es"');
    expect(html).toContain("Crea tu cuenta");
    const list = await setupList();
    const jar = new CookieJar();
    redirect(await postForm("/lang", { lang: "es", back: list.invitePath }, { jar }), list.invitePath);
    expect(jar.get("lang")).toBe("es");
    const invite = await getPage(list.invitePath, { jar, headers: { "accept-language": "en-US" } });
    expect(await invite.text()).toContain('lang="es"');
    redirect(await postForm("/lang", { lang: "en", back: list.invitePath }, { jar }), list.invitePath);
    expect(await (await getPage(list.invitePath, { jar, headers: { "accept-language": "es-ES" } })).text()).toContain('lang="en"');
    expect(await (await getPage("/", { headers: { "accept-language": "fr-FR" } })).text()).toContain('lang="en"');
  });
});
