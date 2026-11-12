import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import {
  guestCookieName,
  isInviteToken,
  isSameOrigin,
  ownerCookieName,
  parseGuestId,
  parseItemId,
  parseListId,
  parseSideGiftId,
  signPrincipal,
  verifyPrincipal,
} from "./domain/auth.js";
import { claimItem, listGuestItems, unclaimItem } from "./domain/claims.js";
import {
  addGuest,
  getGuestForList,
  joinWithCode,
  listOwnerGuests,
  regenerateGuestCode,
  removeGuest,
} from "./domain/guests.js";
import {
  addSideGift,
  deleteSideGift,
  listSideGifts,
  updateSideGift,
} from "./domain/ideas.js";
import { buildShareLinks } from "./domain/invite.js";
import { ipBucket } from "./domain/ip.js";
import {
  addItem,
  createList,
  deleteItem,
  getList,
  getOwnerListView,
  moveItem,
  setItemReceived,
  updateItem,
  verifyOwnerToken,
  type MoveDirection,
  type ReceivedMode,
} from "./domain/lists.js";
import type { GuestId, ItemDraft, ListId, Result } from "./domain/types.js";
import { isLocale, LOCALES, pickLocale, translator, type LocaleCode } from "./i18n/index.js";
import type { Deps } from "./ports.js";
import {
  CreatedView,
  CreateListView,
  GuestListView,
  JoinView,
  OwnerView,
} from "./views/pages.js";
import type { Chrome, GuestListPage, OwnerPage, ShareLinks } from "./views/props.js";

export const MAX_FORM_BYTES = 16 * 1024;

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const PRICE_PATTERN = /^(\d{1,7})(?:[.,](\d{1,2}))?$/;
const SAFE_BACK_PATTERN =
  /^(?:\/|\/(?:o|l)\/[A-Za-z0-9_-]+(?:\/list)?)(?:\?(?:flash=[a-z-]+|i=[A-Za-z0-9_-]{22,64}))?$/;

const AVAILABLE_LOCALES: { code: LocaleCode; name: string }[] = [];
for (const [code, meta] of Object.entries(LOCALES)) {
  if (isLocale(code)) {
    AVAILABLE_LOCALES.push({ code, name: meta.name });
  }
}

function isHttpsApp(appUrl: string): boolean {
  try {
    return new URL(appUrl).protocol === "https:";
  } catch {
    return false;
  }
}

function sessionCookieOptions(appUrl: string) {
  return {
    httpOnly: true,
    secure: isHttpsApp(appUrl),
    sameSite: "Lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

function buildChrome(c: Context, path: string): Chrome {
  const locale = pickLocale(getCookie(c, "lang"), c.req.header("accept-language"));
  return {
    t: translator(locale),
    locale,
    locales: AVAILABLE_LOCALES,
    path,
  };
}

async function readForm(c: Context): Promise<URLSearchParams> {
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

function formString(form: URLSearchParams, key: string): string {
  const values = form.getAll(key);
  return values[values.length - 1] ?? "";
}

function hasFormField(form: URLSearchParams, key: string): boolean {
  return form.has(key);
}

function parseOccasionDate(raw: string): Result<string | null, "invalid"> {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  const match = ISO_DATE_PATTERN.exec(trimmed);
  if (!match) return { ok: false, error: "invalid" };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return { ok: false, error: "invalid" };
  }
  return { ok: true, value: trimmed };
}

function parseCreateListForm(form: URLSearchParams): Result<
  {
    title: string;
    ownerName: string;
    ownerEmail: string;
    occasionDate: string | null;
  },
  "invalid"
> {
  const title = formString(form, "title").trim();
  const ownerName = formString(form, "ownerName").trim();
  const ownerEmail = formString(form, "ownerEmail").trim();
  if (title.length < 1 || title.length > 120) return { ok: false, error: "invalid" };
  if (ownerName.length < 1 || ownerName.length > 120) return { ok: false, error: "invalid" };
  if (ownerEmail.length < 3 || ownerEmail.length > 254 || !EMAIL_PATTERN.test(ownerEmail)) {
    return { ok: false, error: "invalid" };
  }
  const dateResult = parseOccasionDate(formString(form, "occasionDate"));
  if (!dateResult.ok) return dateResult;

  return {
    ok: true,
    value: {
      title,
      ownerName,
      ownerEmail,
      occasionDate: dateResult.value,
    },
  };
}

function parsePriceCents(raw: string): Result<number | null, "invalid"> {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  const match = PRICE_PATTERN.exec(trimmed);
  if (!match) return { ok: false, error: "invalid" };
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  return { ok: true, value: whole * 100 + fraction };
}

function parseHttpUrl(raw: string): Result<string | null, "invalid"> {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (trimmed.length > 2048) return { ok: false, error: "invalid" };
  try {
    const parsed = new URL(trimmed);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
      return { ok: false, error: "invalid" };
    }
    return { ok: true, value: trimmed };
  } catch {
    return { ok: false, error: "invalid" };
  }
}

function parseItemDraftForm(form: URLSearchParams): Result<ItemDraft, "invalid"> {
  const name = formString(form, "name").trim();
  if (name.length < 1 || name.length > 120) return { ok: false, error: "invalid" };

  const priceResult = parsePriceCents(formString(form, "price"));
  if (!priceResult.ok) return priceResult;

  const urlResult = parseHttpUrl(formString(form, "url"));
  if (!urlResult.ok) return urlResult;

  const detailsRaw = formString(form, "details").trim();
  if (detailsRaw.length > 1000) return { ok: false, error: "invalid" };

  return {
    ok: true,
    value: {
      name,
      priceCents: priceResult.value,
      url: urlResult.value,
      details: detailsRaw === "" ? null : detailsRaw,
    },
  };
}

function parseAddGuestForm(
  form: URLSearchParams,
): Result<{ name: string; email: string | null }, "invalid"> {
  const name = formString(form, "name").trim();
  if (name.length < 1 || name.length > 60) return { ok: false, error: "invalid" };

  const emailRaw = formString(form, "email").trim();
  if (emailRaw === "") {
    return { ok: true, value: { name, email: null } };
  }
  if (emailRaw.length > 254 || !EMAIL_PATTERN.test(emailRaw)) {
    return { ok: false, error: "invalid" };
  }
  return { ok: true, value: { name, email: emailRaw } };
}

function parseMoveDirection(
  form: URLSearchParams,
  queryDir: string | undefined,
): Result<MoveDirection, "invalid"> {
  const raw = (
    formString(form, "direction") ||
    formString(form, "dir") ||
    formString(form, "move") ||
    formString(form, "delta") ||
    queryDir ||
    ""
  )
    .trim()
    .toLowerCase();

  if (raw === "up" || raw === "-1") return { ok: true, value: "up" };
  if (raw === "down" || raw === "1" || raw === "+1") return { ok: true, value: "down" };
  return { ok: false, error: "invalid" };
}

function parseReceivedMode(form: URLSearchParams): Result<ReceivedMode, "invalid"> {
  if (!hasFormField(form, "received")) return { ok: true, value: "toggle" };
  const raw = formString(form, "received").trim().toLowerCase();
  if (raw === "") return { ok: true, value: "toggle" };
  if (raw === "1" || raw === "true" || raw === "on") return { ok: true, value: "received" };
  if (raw === "0" || raw === "false" || raw === "off") return { ok: true, value: "unreceived" };
  return { ok: false, error: "invalid" };
}

export function parseSafeBack(raw: string): string {
  return SAFE_BACK_PATTERN.test(raw) ? raw : "/";
}

function parseOwnerFlash(raw: string | undefined): OwnerPage["flash"] {
  if (raw === "guest-added" || raw === "mail-failed" || raw === "invalid") return raw;
  return undefined;
}

function parseGuestFlash(raw: string | undefined): GuestListPage["flash"] {
  if (raw === "already-taken" || raw === "invalid") return raw;
  return undefined;
}

function clientBucket(c: Context, deps: Deps, ipv6Prefix: 48 | 64 = 64): string {
  return ipBucket(deps.clientIp(c.req.raw, c.env), { ipv6Prefix });
}

async function isAuthorizedOwner(c: Context, deps: Deps, listId: ListId): Promise<boolean> {
  const rawCookie = getCookie(c, ownerCookieName(listId));
  const principal = await verifyPrincipal(rawCookie, deps.env.SESSION_SECRET);
  return principal !== null && principal.role === "owner" && principal.listId === listId;
}

async function resolveAuthorizedGuest(
  c: Context,
  deps: Deps,
  listId: ListId,
): Promise<{ id: GuestId; name: string } | null> {
  const cookieName = guestCookieName(listId);
  const rawCookie = getCookie(c, cookieName);
  const principal = await verifyPrincipal(rawCookie, deps.env.SESSION_SECRET);
  if (!principal || principal.role !== "guest" || principal.listId !== listId) {
    return null;
  }
  const guestResult = await getGuestForList(
    deps,
    listId,
    principal.guestId,
    principal.sessionNonce,
  );
  if (!guestResult.ok) {
    deleteCookie(c, cookieName, { path: "/" });
    return null;
  }
  return guestResult.value;
}

async function buildOwnerPage(
  c: Context,
  deps: Deps,
  listId: ListId,
  flash?: OwnerPage["flash"],
): Promise<OwnerPage | null> {
  const ownerView = await getOwnerListView(deps, listId);
  if (!ownerView.ok) return null;

  const guests = await listOwnerGuests(deps, listId);
  const shares: Record<GuestId, ShareLinks> = {};
  for (const guest of guests) {
    if (!guest.joined) {
      shares[guest.id] = buildShareLinks(ownerView.value.list, guest, deps.env.APP_URL);
    }
  }

  return {
    chrome: buildChrome(c, `/o/${listId}`),
    list: ownerView.value.list,
    items: ownerView.value.items,
    guests,
    totalCents: ownerView.value.totalCents,
    daysLeft: ownerView.value.daysLeft,
    shares,
    flash,
  };
}

async function buildGuestPage(
  c: Context,
  deps: Deps,
  listId: ListId,
  guest: { id: GuestId; name: string },
  flash?: GuestListPage["flash"],
): Promise<GuestListPage | null> {
  const listResult = await getList(deps, listId);
  if (!listResult.ok) return null;

  const [items, sideGifts] = await Promise.all([
    listGuestItems(deps, listId, guest.id),
    listSideGifts(deps, listId, guest.id),
  ]);

  return {
    chrome: buildChrome(c, `/l/${listId}/list`),
    list: listResult.value,
    guestName: guest.name,
    items,
    sideGifts,
    flash,
  };
}

export function createApp(getDeps: () => Deps): Hono {
  const app = new Hono();
  const postBodyLimit = bodyLimit({ maxSize: MAX_FORM_BYTES });

  app.use("*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.method !== "OPTIONS") {
      const deps = getDeps();
      if (!isSameOrigin(c.req.header("origin"), deps.env.APP_URL)) {
        return c.text("Forbidden", 403);
      }
    }
    return next();
  });

  app.get("/healthz", (c) => c.text("ok"));

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

  app.get("/", (c) => c.html(CreateListView({ chrome: buildChrome(c, "/") })));

  app.post("/lists", postBodyLimit, async (c) => {
    const deps = getDeps();
    const chrome = buildChrome(c, "/");
    const form = await readForm(c);
    const parsed = parseCreateListForm(form);
    if (!parsed.ok) {
      return c.html(CreateListView({ chrome, error: "invalid" }), 400);
    }

    const created = await createList(
      deps,
      {
        ...parsed.value,
        locale: chrome.locale,
      },
      clientBucket(c, deps, 48),
    );
    if (!created.ok) {
      return c.html(CreateListView({ chrome, error: "rate-limited" }), 429);
    }

    return c.html(
      CreatedView({
        chrome,
        list: created.value.list,
        manageUrl: created.value.manageUrl,
        emailSent: created.value.emailSent,
      }),
    );
  });

  app.get("/o/:id", async (c) => {
    const deps = getDeps();
    const listId = parseListId(c.req.param("id"));
    if (!listId) return c.notFound();

    const token = c.req.query("k");
    if (token !== undefined) {
      const verified = await verifyOwnerToken(deps, listId, token);
      if (!verified.ok) {
        return verified.error === "not-found" ? c.notFound() : c.text("Forbidden", 403);
      }
      const signed = await signPrincipal(
        { role: "owner", listId },
        deps.env.SESSION_SECRET,
      );
      setCookie(c, ownerCookieName(listId), signed, sessionCookieOptions(deps.env.APP_URL));
      return c.redirect(`/o/${listId}`);
    }

    if (!(await isAuthorizedOwner(c, deps, listId))) {
      return c.text("Forbidden", 403);
    }

    const page = await buildOwnerPage(c, deps, listId, parseOwnerFlash(c.req.query("flash")));
    if (!page) return c.notFound();
    return c.html(OwnerView(page));
  });

  app.post("/o/:id/items", postBodyLimit, async (c) => {
    const deps = getDeps();
    const listId = parseListId(c.req.param("id"));
    if (!listId) return c.notFound();
    if (!(await isAuthorizedOwner(c, deps, listId))) return c.text("Forbidden", 403);

    const parsed = parseItemDraftForm(await readForm(c));
    if (!parsed.ok) {
      const page = await buildOwnerPage(c, deps, listId, "invalid");
      return page ? c.html(OwnerView(page), 400) : c.notFound();
    }

    const added = await addItem(deps, listId, parsed.value);
    if (!added.ok) {
      if (added.error === "not-found") return c.notFound();
      const page = await buildOwnerPage(c, deps, listId, "invalid");
      return page ? c.html(OwnerView(page), 400) : c.notFound();
    }

    return c.redirect(`/o/${listId}`);
  });

  app.post("/o/:id/items/:item", postBodyLimit, async (c) => {
    const deps = getDeps();
    const listId = parseListId(c.req.param("id"));
    const itemId = parseItemId(c.req.param("item"));
    if (!listId || !itemId) return c.notFound();
    if (!(await isAuthorizedOwner(c, deps, listId))) return c.text("Forbidden", 403);

    const parsed = parseItemDraftForm(await readForm(c));
    if (!parsed.ok) {
      const page = await buildOwnerPage(c, deps, listId, "invalid");
      return page ? c.html(OwnerView(page), 400) : c.notFound();
    }

    const updated = await updateItem(deps, listId, itemId, parsed.value);
    if (!updated.ok) return c.notFound();

    return c.redirect(`/o/${listId}#item-${itemId}`);
  });

  app.post("/o/:id/items/:item/delete", postBodyLimit, async (c) => {
    const deps = getDeps();
    const listId = parseListId(c.req.param("id"));
    const itemId = parseItemId(c.req.param("item"));
    if (!listId || !itemId) return c.notFound();
    if (!(await isAuthorizedOwner(c, deps, listId))) return c.text("Forbidden", 403);

    const deleted = await deleteItem(deps, listId, itemId);
    if (!deleted.ok) return c.notFound();

    return c.redirect(`/o/${listId}`);
  });

  app.post("/o/:id/items/:item/received", postBodyLimit, async (c) => {
    const deps = getDeps();
    const listId = parseListId(c.req.param("id"));
    const itemId = parseItemId(c.req.param("item"));
    if (!listId || !itemId) return c.notFound();
    if (!(await isAuthorizedOwner(c, deps, listId))) return c.text("Forbidden", 403);

    const modeResult = parseReceivedMode(await readForm(c));
    if (!modeResult.ok) {
      const page = await buildOwnerPage(c, deps, listId, "invalid");
      return page ? c.html(OwnerView(page), 400) : c.notFound();
    }

    const res = await setItemReceived(deps, listId, itemId, modeResult.value);
    if (!res.ok) return c.notFound();

    return c.redirect(`/o/${listId}#item-${itemId}`);
  });

  app.post("/o/:id/items/:item/move", postBodyLimit, async (c) => {
    const deps = getDeps();
    const listId = parseListId(c.req.param("id"));
    const itemId = parseItemId(c.req.param("item"));
    if (!listId || !itemId) return c.notFound();
    if (!(await isAuthorizedOwner(c, deps, listId))) return c.text("Forbidden", 403);

    const form = await readForm(c);
    const dirResult = parseMoveDirection(form, c.req.query("direction") ?? c.req.query("dir"));
    if (!dirResult.ok) {
      const page = await buildOwnerPage(c, deps, listId, "invalid");
      return page ? c.html(OwnerView(page), 400) : c.notFound();
    }

    const moved = await moveItem(deps, listId, itemId, dirResult.value);
    if (!moved.ok) return c.notFound();

    return c.redirect(`/o/${listId}#item-${itemId}`);
  });

  app.post("/o/:id/guests", postBodyLimit, async (c) => {
    const deps = getDeps();
    const listId = parseListId(c.req.param("id"));
    if (!listId) return c.notFound();
    if (!(await isAuthorizedOwner(c, deps, listId))) return c.text("Forbidden", 403);

    const parsed = parseAddGuestForm(await readForm(c));
    if (!parsed.ok) {
      const page = await buildOwnerPage(c, deps, listId, "invalid");
      return page ? c.html(OwnerView(page), 400) : c.notFound();
    }

    const added = await addGuest(deps, listId, parsed.value);
    if (!added.ok) {
      if (added.error === "not-found") return c.notFound();
      const page = await buildOwnerPage(c, deps, listId, "invalid");
      return page ? c.html(OwnerView(page), 400) : c.notFound();
    }

    const flash = added.value.emailSent ? "guest-added" : "mail-failed";
    return c.redirect(`/o/${listId}?flash=${flash}`);
  });

  app.post("/o/:id/guests/:g/delete", postBodyLimit, async (c) => {
    const deps = getDeps();
    const listId = parseListId(c.req.param("id"));
    const guestId = parseGuestId(c.req.param("g"));
    if (!listId || !guestId) return c.notFound();
    if (!(await isAuthorizedOwner(c, deps, listId))) return c.text("Forbidden", 403);

    const removed = await removeGuest(deps, listId, guestId);
    if (!removed.ok) return c.notFound();

    return c.redirect(`/o/${listId}`);
  });

  app.post("/o/:id/guests/:g/code", postBodyLimit, async (c) => {
    const deps = getDeps();
    const listId = parseListId(c.req.param("id"));
    const guestId = parseGuestId(c.req.param("g"));
    if (!listId || !guestId) return c.notFound();
    if (!(await isAuthorizedOwner(c, deps, listId))) return c.text("Forbidden", 403);

    const regenerated = await regenerateGuestCode(deps, listId, guestId);
    if (!regenerated.ok) return c.notFound();

    if (!regenerated.value.emailSent) {
      return c.redirect(`/o/${listId}?flash=mail-failed`);
    }
    return c.redirect(`/o/${listId}#guest-${guestId}`);
  });

  app.get("/l/:id", async (c) => {
    const deps = getDeps();
    const listId = parseListId(c.req.param("id"));
    if (!listId) return c.notFound();

    const listResult = await getList(deps, listId);
    if (!listResult.ok) return c.notFound();

    const existingGuest = await resolveAuthorizedGuest(c, deps, listId);
    if (existingGuest) {
      return c.redirect(`/l/${listId}/list`);
    }

    const rawInvite = c.req.query("i")?.trim() ?? "";
    const invite = rawInvite.length > 0 ? rawInvite : null;

    return c.html(
      JoinView({
        chrome: buildChrome(c, invite && isInviteToken(invite) ? `/l/${listId}?i=${invite}` : `/l/${listId}`),
        list: listResult.value,
        invite,
      }),
    );
  });

  app.post("/l/:id/join", postBodyLimit, async (c) => {
    const deps = getDeps();
    const listId = parseListId(c.req.param("id"));
    if (!listId) return c.notFound();

    const form = await readForm(c);
    const rawInvite = formString(form, "invite").trim();
    if (rawInvite === "") {
      const listResult = await getList(deps, listId);
      if (!listResult.ok) return c.notFound();
      return c.html(
        JoinView({
          chrome: buildChrome(c, `/l/${listId}`),
          list: listResult.value,
          invite: null,
        }),
        400,
      );
    }

    const code = formString(form, "code");
    const joined = await joinWithCode(deps, listId, rawInvite, code, clientBucket(c, deps));

    if (!joined.ok) {
      if (joined.error === "not-found") return c.notFound();
      const listResult = await getList(deps, listId);
      if (!listResult.ok) return c.notFound();
      const status = joined.error === "throttled" ? 429 : 401;
      return c.html(
        JoinView({
          chrome: buildChrome(c, `/l/${listId}`),
          list: listResult.value,
          invite: rawInvite,
          error: joined.error,
        }),
        status,
      );
    }

    const signed = await signPrincipal(
      {
        role: "guest",
        listId,
        guestId: joined.value.guestId,
        sessionNonce: joined.value.sessionNonce,
      },
      deps.env.SESSION_SECRET,
    );
    setCookie(c, guestCookieName(listId), signed, sessionCookieOptions(deps.env.APP_URL));
    return c.redirect(`/l/${listId}/list`);
  });

  app.get("/l/:id/list", async (c) => {
    const deps = getDeps();
    const listId = parseListId(c.req.param("id"));
    if (!listId) return c.notFound();

    const listResult = await getList(deps, listId);
    if (!listResult.ok) return c.notFound();

    const guest = await resolveAuthorizedGuest(c, deps, listId);
    if (!guest) return c.redirect(`/l/${listId}`);

    const page = await buildGuestPage(
      c,
      deps,
      listId,
      guest,
      parseGuestFlash(c.req.query("flash")),
    );
    if (!page) return c.notFound();
    return c.html(GuestListView(page));
  });

  app.post("/l/:id/items/:item/claim", postBodyLimit, async (c) => {
    const deps = getDeps();
    const listId = parseListId(c.req.param("id"));
    const itemId = parseItemId(c.req.param("item"));
    if (!listId || !itemId) return c.notFound();

    const guest = await resolveAuthorizedGuest(c, deps, listId);
    if (!guest) return c.redirect(`/l/${listId}`);

    const claimed = await claimItem(deps, listId, itemId, guest.id);
    if (!claimed.ok) {
      if (claimed.error === "not-found") return c.notFound();
      const flash = claimed.error === "already-taken" ? "already-taken" : "invalid";
      const page = await buildGuestPage(c, deps, listId, guest, flash);
      return page ? c.html(GuestListView(page), 409) : c.notFound();
    }

    return c.redirect(`/l/${listId}/list#item-${itemId}`);
  });

  app.post("/l/:id/items/:item/unclaim", postBodyLimit, async (c) => {
    const deps = getDeps();
    const listId = parseListId(c.req.param("id"));
    const itemId = parseItemId(c.req.param("item"));
    if (!listId || !itemId) return c.notFound();

    const guest = await resolveAuthorizedGuest(c, deps, listId);
    if (!guest) return c.redirect(`/l/${listId}`);

    const unclaimed = await unclaimItem(deps, listId, itemId, guest.id);
    if (!unclaimed.ok) {
      if (unclaimed.error === "not-found") return c.notFound();
      const page = await buildGuestPage(c, deps, listId, guest, "invalid");
      return page ? c.html(GuestListView(page), 409) : c.notFound();
    }

    return c.redirect(`/l/${listId}/list#item-${itemId}`);
  });

  app.post("/l/:id/ideas", postBodyLimit, async (c) => {
    const deps = getDeps();
    const listId = parseListId(c.req.param("id"));
    if (!listId) return c.notFound();

    const guest = await resolveAuthorizedGuest(c, deps, listId);
    if (!guest) return c.redirect(`/l/${listId}`);

    const parsed = parseItemDraftForm(await readForm(c));
    if (!parsed.ok) {
      const page = await buildGuestPage(c, deps, listId, guest, "invalid");
      return page ? c.html(GuestListView(page), 400) : c.notFound();
    }

    const added = await addSideGift(deps, listId, guest.id, parsed.value);
    if (!added.ok) {
      if (added.error === "not-found") return c.notFound();
      const page = await buildGuestPage(c, deps, listId, guest, "invalid");
      return page ? c.html(GuestListView(page), 400) : c.notFound();
    }

    return c.redirect(`/l/${listId}/list#idea-${added.value.id}`);
  });

  app.post("/l/:id/ideas/:idea", postBodyLimit, async (c) => {
    const deps = getDeps();
    const listId = parseListId(c.req.param("id"));
    const ideaId = parseSideGiftId(c.req.param("idea"));
    if (!listId || !ideaId) return c.notFound();

    const guest = await resolveAuthorizedGuest(c, deps, listId);
    if (!guest) return c.redirect(`/l/${listId}`);

    const parsed = parseItemDraftForm(await readForm(c));
    if (!parsed.ok) {
      const page = await buildGuestPage(c, deps, listId, guest, "invalid");
      return page ? c.html(GuestListView(page), 400) : c.notFound();
    }

    const updated = await updateSideGift(deps, listId, ideaId, guest.id, parsed.value);
    if (!updated.ok) return c.notFound();

    return c.redirect(`/l/${listId}/list#idea-${ideaId}`);
  });

  app.post("/l/:id/ideas/:idea/delete", postBodyLimit, async (c) => {
    const deps = getDeps();
    const listId = parseListId(c.req.param("id"));
    const ideaId = parseSideGiftId(c.req.param("idea"));
    if (!listId || !ideaId) return c.notFound();

    const guest = await resolveAuthorizedGuest(c, deps, listId);
    if (!guest) return c.redirect(`/l/${listId}`);

    const deleted = await deleteSideGift(deps, listId, ideaId, guest.id);
    if (!deleted.ok) return c.notFound();

    return c.redirect(`/l/${listId}/list`);
  });

  return app;
}
