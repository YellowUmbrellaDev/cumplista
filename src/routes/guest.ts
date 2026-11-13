import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie } from "hono/cookie";
import { guestCookieName, parseItemId, parseListId, parseSideGiftId } from "../domain/auth.js";
import { claimItem, listGuestItems, unclaimItem } from "../domain/claims.js";
import { loginGuest, registerGuest } from "../domain/guests.js";
import { addSideGift, deleteSideGift, listSideGifts, updateSideGift } from "../domain/ideas.js";
import { getListById, getListByInviteToken } from "../domain/lists.js";
import type { GuestId, ListRecord } from "../domain/types.js";
import type { Deps } from "../ports.js";
import { GuestListView, GuestLoginView, InviteView } from "../views/pages.js";
import type { GuestListPage, InvitePage } from "../views/props.js";
import { parseItemDraftForm } from "./forms.js";
import {
  clientBucket,
  formString,
  guestChrome,
  MAX_FORM_BYTES,
  buildChrome,
  readForm,
  resolveGuest,
  setGuestSession,
} from "./http.js";

type Guest = { id: GuestId; displayName: string };

function guestFlash(raw: string | undefined): GuestListPage["flash"] {
  return raw === "already-taken" || raw === "invalid" ? raw : undefined;
}

async function captchaOk(deps: Deps, c: Context, form: URLSearchParams): Promise<boolean> {
  if (deps.captcha.siteKey === null) return true;
  const token = formString(form, "cf-turnstile-response");
  if (!token) return false;
  return deps.captcha.verify(token, deps.clientIp(c.req.raw, c.env));
}

async function buildGuestPage(
  c: Context,
  deps: Deps,
  list: ListRecord,
  guest: Guest,
  flash?: GuestListPage["flash"],
): Promise<GuestListPage> {
  const [items, sideGifts] = await Promise.all([
    listGuestItems(deps, list.id, guest.id),
    listSideGifts(deps, list.id, guest.id),
  ]);
  return {
    chrome: guestChrome(c, `/l/${list.id}/list`, list.id, guest),
    list,
    guestName: guest.displayName,
    items,
    sideGifts,
    ...(flash ? { flash } : {}),
  };
}

export function guestRoutes(getDeps: () => Deps): Hono {
  const app = new Hono();
  const postBodyLimit = bodyLimit({ maxSize: MAX_FORM_BYTES });

  const invitePage = (
    c: Context,
    deps: Deps,
    list: ListRecord,
    token: string,
    extra: Partial<Pick<InvitePage, "registerError" | "loginError">> = {},
    values = { firstName: "", lastName: "", email: "" },
  ) =>
    InviteView({
      chrome: buildChrome(c, `/i/${token}`),
      list,
      token,
      captchaSiteKey: deps.captcha.siteKey,
      values,
      ...extra,
    });

  app.get("/i/:token", async (c) => {
    const deps = getDeps();
    const token = c.req.param("token");
    const list = await getListByInviteToken(deps, token);
    if (!list) return c.notFound();
    const guest = await resolveGuest(c, deps, list.id);
    if (guest) return c.redirect(`/l/${list.id}/list`);
    return c.html(invitePage(c, deps, list, token));
  });

  app.post("/i/:token/register", postBodyLimit, async (c) => {
    const deps = getDeps();
    const token = c.req.param("token");
    const list = await getListByInviteToken(deps, token);
    if (!list) return c.notFound();
    const form = await readForm(c);
    const values = {
      firstName: formString(form, "firstName").trim(),
      lastName: formString(form, "lastName").trim(),
      email: formString(form, "email").trim(),
    };
    if (!(await captchaOk(deps, c, form))) {
      return c.html(invitePage(c, deps, list, token, { registerError: "captcha" }, values), 400);
    }
    const res = await registerGuest(
      deps,
      { listId: list.id, ...values, pin: formString(form, "pin") },
      clientBucket(c, deps),
    );
    if (!res.ok) {
      const status = res.error === "throttled" ? 429 : res.error === "email-taken" ? 409 : 400;
      return c.html(invitePage(c, deps, list, token, { registerError: res.error }, values), status);
    }
    await setGuestSession(c, deps, list.id, res.value.guestId, res.value.nonce);
    return c.redirect(`/l/${list.id}/list`);
  });

  app.post("/i/:token/login", postBodyLimit, async (c) => {
    const deps = getDeps();
    const token = c.req.param("token");
    const list = await getListByInviteToken(deps, token);
    if (!list) return c.notFound();
    const form = await readForm(c);
    const email = formString(form, "email").trim();
    const res = await loginGuest(
      deps,
      { listId: list.id, email, pin: formString(form, "pin") },
      clientBucket(c, deps),
    );
    if (!res.ok) {
      return c.html(
        invitePage(c, deps, list, token, { loginError: res.error }, { firstName: "", lastName: "", email }),
        res.error === "throttled" ? 429 : 401,
      );
    }
    await setGuestSession(c, deps, list.id, res.value.guestId, res.value.nonce);
    return c.redirect(`/l/${list.id}/list`);
  });

  const withList = async (c: Context): Promise<{ deps: Deps; list: ListRecord | null }> => {
    const deps = getDeps();
    const listId = parseListId(c.req.param("id"));
    return { deps, list: listId ? await getListById(deps, listId) : null };
  };

  app.get("/l/:id", async (c) => {
    const { deps, list } = await withList(c);
    if (!list) return c.notFound();
    if (await resolveGuest(c, deps, list.id)) return c.redirect(`/l/${list.id}/list`);
    return c.html(
      GuestLoginView({ chrome: buildChrome(c, `/l/${list.id}`), list, email: "" }),
    );
  });

  app.post("/l/:id/login", postBodyLimit, async (c) => {
    const { deps, list } = await withList(c);
    if (!list) return c.notFound();
    const form = await readForm(c);
    const email = formString(form, "email").trim();
    const res = await loginGuest(
      deps,
      { listId: list.id, email, pin: formString(form, "pin") },
      clientBucket(c, deps),
    );
    if (!res.ok) {
      return c.html(
        GuestLoginView({ chrome: buildChrome(c, `/l/${list.id}`), list, email, error: res.error }),
        res.error === "throttled" ? 429 : 401,
      );
    }
    await setGuestSession(c, deps, list.id, res.value.guestId, res.value.nonce);
    return c.redirect(`/l/${list.id}/list`);
  });

  app.post("/l/:id/logout", postBodyLimit, async (c) => {
    const { list } = await withList(c);
    if (!list) return c.notFound();
    deleteCookie(c, guestCookieName(list.id), { path: "/" });
    return c.redirect(`/l/${list.id}`);
  });

  const signedIn = async (c: Context) => {
    const { deps, list } = await withList(c);
    const guest = list ? await resolveGuest(c, deps, list.id) : null;
    return { deps, list, guest };
  };

  app.get("/l/:id/list", async (c) => {
    const { deps, list, guest } = await signedIn(c);
    if (!list) return c.notFound();
    if (!guest) return c.redirect(`/l/${list.id}`);
    return c.html(GuestListView(await buildGuestPage(c, deps, list, guest, guestFlash(c.req.query("flash")))));
  });

  const fail = async (
    c: Context,
    deps: Deps,
    list: ListRecord,
    guest: Guest,
    flash: NonNullable<GuestListPage["flash"]>,
    status: 400 | 409,
  ) => c.html(GuestListView(await buildGuestPage(c, deps, list, guest, flash)), status);

  app.post("/l/:id/items/:item/claim", postBodyLimit, async (c) => {
    const { deps, list, guest } = await signedIn(c);
    const itemId = parseItemId(c.req.param("item"));
    if (!list || !itemId) return c.notFound();
    if (!guest) return c.redirect(`/l/${list.id}`);
    const res = await claimItem(deps, list.id, itemId, guest.id);
    if (!res.ok) {
      if (res.error === "not-found") return c.notFound();
      return fail(c, deps, list, guest, res.error === "already-taken" ? "already-taken" : "invalid", 409);
    }
    return c.redirect(`/l/${list.id}/list#item-${itemId}`);
  });

  app.post("/l/:id/items/:item/unclaim", postBodyLimit, async (c) => {
    const { deps, list, guest } = await signedIn(c);
    const itemId = parseItemId(c.req.param("item"));
    if (!list || !itemId) return c.notFound();
    if (!guest) return c.redirect(`/l/${list.id}`);
    const res = await unclaimItem(deps, list.id, itemId, guest.id);
    if (!res.ok) {
      return res.error === "not-found" ? c.notFound() : fail(c, deps, list, guest, "invalid", 409);
    }
    return c.redirect(`/l/${list.id}/list#item-${itemId}`);
  });

  app.post("/l/:id/ideas", postBodyLimit, async (c) => {
    const { deps, list, guest } = await signedIn(c);
    if (!list) return c.notFound();
    if (!guest) return c.redirect(`/l/${list.id}`);
    const parsed = parseItemDraftForm(await readForm(c));
    if (!parsed.ok) return fail(c, deps, list, guest, "invalid", 400);
    const res = await addSideGift(deps, list.id, guest.id, parsed.value);
    if (!res.ok) {
      return res.error === "not-found" ? c.notFound() : fail(c, deps, list, guest, "invalid", 400);
    }
    return c.redirect(`/l/${list.id}/list#idea-${res.value.id}`);
  });

  app.post("/l/:id/ideas/:idea", postBodyLimit, async (c) => {
    const { deps, list, guest } = await signedIn(c);
    const ideaId = parseSideGiftId(c.req.param("idea"));
    if (!list || !ideaId) return c.notFound();
    if (!guest) return c.redirect(`/l/${list.id}`);
    const parsed = parseItemDraftForm(await readForm(c));
    if (!parsed.ok) return fail(c, deps, list, guest, "invalid", 400);
    const res = await updateSideGift(deps, list.id, ideaId, guest.id, parsed.value);
    return res.ok ? c.redirect(`/l/${list.id}/list#idea-${ideaId}`) : c.notFound();
  });

  app.post("/l/:id/ideas/:idea/delete", postBodyLimit, async (c) => {
    const { deps, list, guest } = await signedIn(c);
    const ideaId = parseSideGiftId(c.req.param("idea"));
    if (!list || !ideaId) return c.notFound();
    if (!guest) return c.redirect(`/l/${list.id}`);
    const res = await deleteSideGift(deps, list.id, ideaId, guest.id);
    return res.ok ? c.redirect(`/l/${list.id}/list`) : c.notFound();
  });

  return app;
}
