import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { parseItemId, parseListId } from "../domain/auth.js";
import { inviteUrl, buildShareLinks } from "../domain/invite.js";
import {
  addItem,
  computeDaysLeft,
  createList,
  deleteItem,
  deleteList,
  getOwnerListView,
  listUserLists,
  moveItem,
  regenerateInviteToken,
  setItemReceived,
  updateItem,
} from "../domain/lists.js";
import type { ListId, UserRecord } from "../domain/types.js";
import { isLocale } from "../i18n/index.js";
import type { Deps } from "../ports.js";
import { DashboardView, OwnerView } from "../views/pages.js";
import type { DashboardPage, OwnerPage } from "../views/props.js";
import {
  parseItemDraftForm,
  parseMoveDirection,
  parseOccasionDate,
  parseReceivedMode,
} from "./forms.js";
import {
  formString,
  MAX_FORM_BYTES,
  ownerChrome,
  pickRequestLocale,
  readForm,
  resolveOwner,
} from "./http.js";

function dashboardFlash(raw: string | undefined): DashboardPage["flash"] {
  if (raw === "created" || raw === "deleted" || raw === "invalid") return raw;
  return undefined;
}

function ownerFlash(raw: string | undefined): OwnerPage["flash"] {
  return raw === "invite-regenerated" || raw === "invalid" ? raw : undefined;
}

async function buildOwnerPage(
  c: Context,
  deps: Deps,
  user: UserRecord,
  listId: ListId,
  flash?: OwnerPage["flash"],
): Promise<OwnerPage | null> {
  const view = await getOwnerListView(deps, user.id, listId);
  if (!view) return null;
  const chrome = ownerChrome(c, `/o/${listId}`, user);
  const url = inviteUrl(deps.env.APP_URL, view.list.inviteToken);
  return {
    chrome,
    list: view.list,
    items: view.items,
    totalCents: view.totalCents,
    daysLeft: computeDaysLeft(view.list.occasionDate, deps.now()),
    inviteUrl: url,
    share: buildShareLinks(chrome.t, view.list, url),
    ...(flash ? { flash } : {}),
  };
}

export function ownerRoutes(getDeps: () => Deps): Hono {
  const app = new Hono();
  const postBodyLimit = bodyLimit({ maxSize: MAX_FORM_BYTES });

  app.get("/dashboard", async (c) => {
    const deps = getDeps();
    const user = await resolveOwner(c, deps);
    if (!user) return c.redirect("/login");
    const lists = await listUserLists(deps, user.id);
    const flash = dashboardFlash(c.req.query("flash"));
    return c.html(
      DashboardView({
        chrome: ownerChrome(c, "/dashboard", user),
        userName: user.name,
        lists: lists.map((l) => ({
          id: l.id,
          title: l.title,
          occasionDate: l.occasionDate,
          daysLeft: computeDaysLeft(l.occasionDate, deps.now()),
          itemCount: l.itemCount,
        })),
        ...(flash ? { flash } : {}),
      }),
    );
  });

  app.post("/lists", postBodyLimit, async (c) => {
    const deps = getDeps();
    const user = await resolveOwner(c, deps);
    if (!user) return c.redirect("/login");
    const form = await readForm(c);
    const title = formString(form, "title").trim();
    const date = parseOccasionDate(formString(form, "occasionDate"));
    const requested = formString(form, "locale").trim();
    const locale = isLocale(requested) ? requested : pickRequestLocale(c);
    const showDashboard = async (
      flash: NonNullable<DashboardPage["flash"]>,
      status: 400 | 429,
    ) => {
      const lists = await listUserLists(deps, user.id);
      return c.html(
        DashboardView({
          chrome: ownerChrome(c, "/dashboard", user),
          userName: user.name,
          lists: lists.map((l) => ({
            id: l.id,
            title: l.title,
            occasionDate: l.occasionDate,
            daysLeft: computeDaysLeft(l.occasionDate, deps.now()),
            itemCount: l.itemCount,
          })),
          flash,
        }),
        status,
      );
    };
    if (!date.ok) return showDashboard("invalid", 400);
    const created = await createList(deps, user.id, { title, locale, occasionDate: date.value });
    if (!created.ok) {
      if (created.error === "rate-limited") return showDashboard("rate-limited", 429);
      return showDashboard(created.error === "cap-reached" ? "cap-reached" : "invalid", 400);
    }
    return c.redirect(`/o/${created.value.id}`);
  });

  const owned = async (c: Context) => {
    const deps = getDeps();
    const user = await resolveOwner(c, deps);
    const listId = parseListId(c.req.param("id"));
    return { deps, user, listId };
  };

  app.get("/o/:id", async (c) => {
    const { deps, user, listId } = await owned(c);
    if (!user) return c.redirect("/login");
    if (!listId) return c.notFound();
    const page = await buildOwnerPage(c, deps, user, listId, ownerFlash(c.req.query("flash")));
    return page ? c.html(OwnerView(page)) : c.notFound();
  });

  const invalid = async (c: Context, deps: Deps, user: UserRecord, listId: ListId) => {
    const page = await buildOwnerPage(c, deps, user, listId, "invalid");
    return page ? c.html(OwnerView(page), 400) : c.notFound();
  };

  app.post("/o/:id/items", postBodyLimit, async (c) => {
    const { deps, user, listId } = await owned(c);
    if (!user) return c.redirect("/login");
    if (!listId) return c.notFound();
    const parsed = parseItemDraftForm(await readForm(c));
    if (!parsed.ok) return invalid(c, deps, user, listId);
    if (!(await getOwnerListView(deps, user.id, listId))) return c.notFound();
    const added = await addItem(deps, listId, parsed.value);
    if (!added.ok) {
      return added.error === "not-found" ? c.notFound() : invalid(c, deps, user, listId);
    }
    return c.redirect(`/o/${listId}`);
  });

  app.post("/o/:id/items/:item", postBodyLimit, async (c) => {
    const { deps, user, listId } = await owned(c);
    const itemId = parseItemId(c.req.param("item"));
    if (!user) return c.redirect("/login");
    if (!listId || !itemId) return c.notFound();
    if (!(await getOwnerListView(deps, user.id, listId))) return c.notFound();
    const parsed = parseItemDraftForm(await readForm(c));
    if (!parsed.ok) return invalid(c, deps, user, listId);
    const updated = await updateItem(deps, listId, itemId, parsed.value);
    return updated.ok ? c.redirect(`/o/${listId}#item-${itemId}`) : c.notFound();
  });

  app.post("/o/:id/items/:item/delete", postBodyLimit, async (c) => {
    const { deps, user, listId } = await owned(c);
    const itemId = parseItemId(c.req.param("item"));
    if (!user) return c.redirect("/login");
    if (!listId || !itemId) return c.notFound();
    if (!(await getOwnerListView(deps, user.id, listId))) return c.notFound();
    const deleted = await deleteItem(deps, listId, itemId);
    return deleted.ok ? c.redirect(`/o/${listId}`) : c.notFound();
  });

  app.post("/o/:id/items/:item/received", postBodyLimit, async (c) => {
    const { deps, user, listId } = await owned(c);
    const itemId = parseItemId(c.req.param("item"));
    if (!user) return c.redirect("/login");
    if (!listId || !itemId) return c.notFound();
    if (!(await getOwnerListView(deps, user.id, listId))) return c.notFound();
    const mode = parseReceivedMode(await readForm(c));
    if (!mode.ok) return invalid(c, deps, user, listId);
    const res = await setItemReceived(deps, listId, itemId, mode.value);
    return res.ok ? c.redirect(`/o/${listId}#item-${itemId}`) : c.notFound();
  });

  app.post("/o/:id/items/:item/move", postBodyLimit, async (c) => {
    const { deps, user, listId } = await owned(c);
    const itemId = parseItemId(c.req.param("item"));
    if (!user) return c.redirect("/login");
    if (!listId || !itemId) return c.notFound();
    if (!(await getOwnerListView(deps, user.id, listId))) return c.notFound();
    const dir = parseMoveDirection(await readForm(c), c.req.query("direction") ?? c.req.query("dir"));
    if (!dir.ok) return invalid(c, deps, user, listId);
    const moved = await moveItem(deps, listId, itemId, dir.value);
    return moved.ok ? c.redirect(`/o/${listId}#item-${itemId}`) : c.notFound();
  });

  app.post("/o/:id/invite", postBodyLimit, async (c) => {
    const { deps, user, listId } = await owned(c);
    if (!user) return c.redirect("/login");
    if (!listId) return c.notFound();
    const list = await regenerateInviteToken(deps, user.id, listId);
    return list ? c.redirect(`/o/${listId}?flash=invite-regenerated`) : c.notFound();
  });

  app.post("/o/:id/delete", postBodyLimit, async (c) => {
    const { deps, user, listId } = await owned(c);
    if (!user) return c.redirect("/login");
    if (!listId) return c.notFound();
    const removed = await deleteList(deps, user.id, listId);
    return removed ? c.redirect("/dashboard?flash=deleted") : c.notFound();
  });

  return app;
}
