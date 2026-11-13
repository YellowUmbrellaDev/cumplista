import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import {
  guestCookieName,
  ownerCookieName,
  signPrincipal,
  verifyPrincipal,
} from "../domain/auth.js";
import { ipBucket } from "../domain/ip.js";
import { getGuestForPrincipal } from "../domain/guests.js";
import { getUserForPrincipal } from "../domain/users.js";
import type { GuestId, ListId, SessionNonce, UserId, UserRecord } from "../domain/types.js";
import { isLocale, LOCALES, pickLocale, translator, type LocaleCode } from "../i18n/index.js";
import type { Deps } from "../ports.js";
import type { Chrome } from "../views/props.js";

export const MAX_FORM_BYTES = 16 * 1024;
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const SAFE_BACK_PATTERN =
  /^(?:\/(?:dashboard)?|\/(?:o|l)\/[A-Za-z0-9_-]+(?:\/list)?|\/i\/[A-Za-z0-9_-]{22,64})(?:\?flash=[a-z-]+)?$/;

const AVAILABLE_LOCALES: { code: LocaleCode; name: string }[] = [];
for (const [code, meta] of Object.entries(LOCALES)) {
  if (isLocale(code)) AVAILABLE_LOCALES.push({ code, name: meta.name });
}

export type AppContext = Context;

export type Viewer =
  | { role: "owner"; user: UserRecord }
  | { role: "guest"; guest: { id: GuestId; displayName: string } };

export function isHttpsApp(appUrl: string): boolean {
  try {
    return new URL(appUrl).protocol === "https:";
  } catch {
    return false;
  }
}

export function sessionCookieOptions(appUrl: string) {
  return {
    httpOnly: true,
    secure: isHttpsApp(appUrl),
    sameSite: "Lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export function pickRequestLocale(c: Context): LocaleCode {
  return pickLocale(getCookie(c, "lang"), c.req.header("accept-language"));
}

export function buildChrome(
  c: Context,
  path: string,
  session: Chrome["session"] = null,
): Chrome {
  const locale = pickRequestLocale(c);
  return { t: translator(locale), locale, locales: AVAILABLE_LOCALES, path, session };
}

export async function readForm(c: Context): Promise<URLSearchParams> {
  const rawType = c.req.header("content-type") ?? "";
  const mediaType = (rawType.split(";")[0] ?? "").trim().toLowerCase();
  if (mediaType !== "application/x-www-form-urlencoded") {
    throw new HTTPException(415, { message: "Unsupported Media Type" });
  }
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength > MAX_FORM_BYTES) {
    throw new HTTPException(413, { message: "Payload Too Large" });
  }
  return new URLSearchParams(new TextDecoder().decode(buf));
}

export function formString(form: URLSearchParams, key: string): string {
  const values = form.getAll(key);
  return values[values.length - 1] ?? "";
}

export function parseSafeBack(raw: string): string {
  return SAFE_BACK_PATTERN.test(raw) ? raw : "/";
}

export function clientBucket(c: Context, deps: Deps, ipv6Prefix: 48 | 64 = 64): string {
  return ipBucket(deps.clientIp(c.req.raw, c.env), { ipv6Prefix });
}

export async function setOwnerSession(
  c: Context,
  deps: Deps,
  userId: UserId,
  epoch: number,
): Promise<void> {
  const signed = await signPrincipal({ role: "owner", userId, epoch }, deps.env.SESSION_SECRET);
  setCookie(c, ownerCookieName(), signed, sessionCookieOptions(deps.env.APP_URL));
}

export async function setGuestSession(
  c: Context,
  deps: Deps,
  listId: ListId,
  guestId: GuestId,
  nonce: SessionNonce,
): Promise<void> {
  const signed = await signPrincipal(
    { role: "guest", listId, guestId, nonce },
    deps.env.SESSION_SECRET,
  );
  setCookie(c, guestCookieName(listId), signed, sessionCookieOptions(deps.env.APP_URL));
}

export async function resolveOwner(c: Context, deps: Deps): Promise<UserRecord | null> {
  const principal = await verifyPrincipal(getCookie(c, ownerCookieName()), deps.env.SESSION_SECRET);
  if (!principal || principal.role !== "owner") return null;
  const user = await getUserForPrincipal(deps, principal.userId, principal.epoch);
  if (!user) deleteCookie(c, ownerCookieName(), { path: "/" });
  return user;
}

export async function resolveGuest(
  c: Context,
  deps: Deps,
  listId: ListId,
): Promise<{ id: GuestId; displayName: string } | null> {
  const name = guestCookieName(listId);
  const principal = await verifyPrincipal(getCookie(c, name), deps.env.SESSION_SECRET);
  if (!principal || principal.role !== "guest" || principal.listId !== listId) return null;
  const guest = await getGuestForPrincipal(deps, listId, principal.guestId, principal.nonce);
  if (!guest) deleteCookie(c, name, { path: "/" });
  return guest;
}

export function ownerChrome(c: Context, path: string, user: UserRecord | null): Chrome {
  return buildChrome(c, path, user ? { name: user.name, logoutAction: "/logout" } : null);
}

export function guestChrome(
  c: Context,
  path: string,
  listId: ListId,
  guest: { displayName: string } | null,
): Chrome {
  return buildChrome(
    c,
    path,
    guest ? { name: guest.displayName, logoutAction: `/l/${listId}/logout` } : null,
  );
}
