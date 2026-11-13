import { DEFAULT_LOCALE, isLocale, type LocaleCode } from "../i18n/index.js";
import type { Deps } from "../ports.js";
import { generateInviteToken, isInviteToken, isItemId, isListId, newItemId, newListId } from "./auth.js";
import { DAY_MS, take } from "./rate.js";
import type { ItemDraft, ItemId, ListId, ListRecord, OwnerItem, OwnerList, Result, UserId } from "./types.js";

export const MAX_ITEMS_PER_LIST = 500;

export type CreateListInput = { title: string; locale: LocaleCode; occasionDate: string | null };
export type MoveDirection = "up" | "down";
export type ReceivedMode = "toggle" | "received" | "unreceived";

type ListRow = {
  id: string;
  title: string;
  owner_name: string;
  locale: string;
  occasion_date: string | null;
};

type OwnerListRow = ListRow & { invite_token: string };

type OwnerItemRow = {
  id: string;
  name: string;
  price_cents: number | null;
  url: string | null;
  details: string | null;
  received_at: string | null;
};

type ItemPositionRow = { id: string; position: number };

const LIST_COLUMNS = "l.id, l.title, u.name AS owner_name, l.locale, l.occasion_date";

function toListRecord(row: ListRow): ListRecord | null {
  if (!isListId(row.id)) return null;
  return {
    id: row.id,
    title: row.title,
    ownerName: row.owner_name,
    locale: isLocale(row.locale) ? row.locale : DEFAULT_LOCALE,
    occasionDate: row.occasion_date,
  };
}

function toOwnerList(row: OwnerListRow): OwnerList | null {
  const list = toListRecord(row);
  return list && isInviteToken(row.invite_token) ? { ...list, inviteToken: row.invite_token } : null;
}

function toOwnerItem(row: OwnerItemRow): OwnerItem | null {
  if (!isItemId(row.id)) return null;
  return {
    id: row.id,
    name: row.name,
    priceCents: row.price_cents,
    url: row.url,
    details: row.details,
    received: row.received_at !== null,
  };
}

function validDate(value: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function computeDaysLeft(occasionDate: string | null, now: Date): number | null {
  if (occasionDate === null || !validDate(occasionDate)) return null;
  const target = new Date(`${occasionDate}T00:00:00.000Z`).getTime();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / DAY_MS);
}

export async function createList(
  deps: Deps,
  userId: UserId,
  input: CreateListInput,
): Promise<Result<OwnerList, "invalid" | "rate-limited" | "cap-reached">> {
  const title = input.title.trim();
  if (!title || title.length > 120 || !isLocale(input.locale) ||
      (input.occasionDate !== null && !validDate(input.occasionDate))) {
    return { ok: false, error: "invalid" };
  }
  const ticket = await take(deps,
    { kind: "list-create", scope: userId, client: userId, at: deps.now().getTime() },
    [{ kind: "list-create", scope: userId, client: null, limit: 20, windowMs: DAY_MS }],
  );
  if (!ticket.ok) return { ok: false, error: "rate-limited" };
  const id = newListId();
  const inserted = await deps.sql.run(
    `INSERT INTO lists (id, owner_user_id, title, locale, occasion_date, invite_token, created_at)
     SELECT ?, id, ?, ?, ?, ?, ? FROM users
     WHERE id = ? AND (SELECT COUNT(*) FROM lists WHERE owner_user_id = ?) < 50`,
    id, title, input.locale, input.occasionDate, generateInviteToken(), deps.now().toISOString(), userId, userId,
  );
  if (inserted.changes === 0) return { ok: false, error: "cap-reached" };
  const row = await deps.sql.first<OwnerListRow>(
    `SELECT ${LIST_COLUMNS}, l.invite_token FROM lists l JOIN users u ON u.id = l.owner_user_id
     WHERE l.id = ? AND l.owner_user_id = ?`, id, userId,
  );
  const list = row ? toOwnerList(row) : null;
  return list ? { ok: true, value: list } : { ok: false, error: "invalid" };
}

export async function listUserLists(
  deps: Deps,
  userId: UserId,
): Promise<{ id: ListId; title: string; occasionDate: string | null; itemCount: number }[]> {
  const rows = await deps.sql.all<{ id: string; title: string; occasion_date: string | null; item_count: number }>(
    `SELECT l.id, l.title, l.occasion_date,
       (SELECT COUNT(*) FROM items i WHERE i.list_id = l.id) AS item_count
     FROM lists l WHERE l.owner_user_id = ? ORDER BY l.created_at DESC, l.rowid DESC`, userId,
  );
  return rows.flatMap((row) => isListId(row.id)
    ? [{ id: row.id, title: row.title, occasionDate: row.occasion_date, itemCount: row.item_count }] : []);
}

export async function getOwnerListView(
  deps: Deps,
  userId: UserId,
  listId: ListId,
): Promise<{ list: OwnerList; items: OwnerItem[]; totalCents: number } | null> {
  const row = await deps.sql.first<OwnerListRow>(
    `SELECT ${LIST_COLUMNS}, l.invite_token FROM lists l JOIN users u ON u.id = l.owner_user_id
     WHERE l.id = ? AND l.owner_user_id = ?`, listId, userId,
  );
  const list = row ? toOwnerList(row) : null;
  if (!list) return null;
  const rows = await deps.sql.all<OwnerItemRow>(
    `SELECT id, name, price_cents, url, details, received_at
     FROM items WHERE list_id = ? ORDER BY position ASC, id ASC`, listId,
  );
  const items = rows.flatMap((itemRow) => {
    const item = toOwnerItem(itemRow);
    return item ? [item] : [];
  });
  return { list, items, totalCents: items.reduce((total, item) => total + (item.priceCents ?? 0), 0) };
}

export async function regenerateInviteToken(deps: Deps, userId: UserId, listId: ListId): Promise<OwnerList | null> {
  const result = await deps.sql.run(
    "UPDATE lists SET invite_token = ? WHERE id = ? AND owner_user_id = ?",
    generateInviteToken(), listId, userId,
  );
  if (result.changes === 0) return null;
  const row = await deps.sql.first<OwnerListRow>(
    `SELECT ${LIST_COLUMNS}, l.invite_token FROM lists l JOIN users u ON u.id = l.owner_user_id
     WHERE l.id = ? AND l.owner_user_id = ?`, listId, userId,
  );
  return row ? toOwnerList(row) : null;
}

export async function deleteList(deps: Deps, userId: UserId, listId: ListId): Promise<boolean> {
  const result = await deps.sql.run("DELETE FROM lists WHERE id = ? AND owner_user_id = ?", listId, userId);
  return result.changes !== 0;
}

export async function getListById(deps: Deps, listId: ListId): Promise<ListRecord | null> {
  const row = await deps.sql.first<ListRow>(
    `SELECT ${LIST_COLUMNS} FROM lists l JOIN users u ON u.id = l.owner_user_id WHERE l.id = ?`, listId,
  );
  return row ? toListRecord(row) : null;
}

export async function getListByInviteToken(deps: Deps, token: string): Promise<ListRecord | null> {
  if (!isInviteToken(token)) return null;
  const row = await deps.sql.first<ListRow>(
    `SELECT ${LIST_COLUMNS} FROM lists l JOIN users u ON u.id = l.owner_user_id WHERE l.invite_token = ?`, token,
  );
  return row ? toListRecord(row) : null;
}

export async function addItem(
  deps: Deps,
  listId: ListId,
  draft: ItemDraft,
): Promise<Result<OwnerItem, "not-found" | "cap-reached">> {
  if (!await getListById(deps, listId)) return { ok: false, error: "not-found" };

  const id = newItemId();
  const inserted = await deps.sql.run(
    `INSERT INTO items (id, list_id, name, price_cents, url, details, position, received_at)
     SELECT ?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(position) + 1 FROM items WHERE list_id = ?), 0), NULL
     WHERE (SELECT COUNT(*) FROM items WHERE list_id = ?) < ?`,
    id,
    listId,
    draft.name,
    draft.priceCents,
    draft.url,
    draft.details,
    listId,
    listId,
    MAX_ITEMS_PER_LIST,
  );
  if (inserted.changes === 0) return { ok: false, error: "cap-reached" };

  return {
    ok: true,
    value: {
      id,
      ...draft,
      received: false,
    },
  };
}

export async function updateItem(
  deps: Deps,
  listId: ListId,
  itemId: ItemId,
  draft: ItemDraft,
): Promise<Result<void, "not-found">> {
  const res = await deps.sql.run(
    `UPDATE items
     SET name = ?, price_cents = ?, url = ?, details = ?
     WHERE id = ? AND list_id = ?`,
    draft.name,
    draft.priceCents,
    draft.url,
    draft.details,
    itemId,
    listId,
  );
  if (res.changes === 0) return { ok: false, error: "not-found" };
  return { ok: true, value: undefined };
}

export async function deleteItem(
  deps: Deps,
  listId: ListId,
  itemId: ItemId,
): Promise<Result<void, "not-found">> {
  const res = await deps.sql.run(
    `DELETE FROM items WHERE id = ? AND list_id = ?`,
    itemId,
    listId,
  );
  if (res.changes === 0) return { ok: false, error: "not-found" };
  return { ok: true, value: undefined };
}

export async function setItemReceived(
  deps: Deps,
  listId: ListId,
  itemId: ItemId,
  mode: ReceivedMode,
): Promise<Result<void, "not-found">> {
  const nowIso = deps.now().toISOString();
  let res: { changes: number };

  switch (mode) {
    case "toggle":
      res = await deps.sql.run(
        `UPDATE items
         SET received_at = CASE WHEN received_at IS NULL THEN ? ELSE NULL END
         WHERE id = ? AND list_id = ?`,
        nowIso,
        itemId,
        listId,
      );
      break;
    case "received":
      res = await deps.sql.run(
        `UPDATE items
         SET received_at = COALESCE(received_at, ?)
         WHERE id = ? AND list_id = ?`,
        nowIso,
        itemId,
        listId,
      );
      break;
    case "unreceived":
      res = await deps.sql.run(
        `UPDATE items
         SET received_at = NULL
         WHERE id = ? AND list_id = ?`,
        itemId,
        listId,
      );
      break;
    default: {
      const exhaustive: never = mode;
      throw new Error(`Unsupported received mode: ${String(exhaustive)}`);
    }
  }

  if (res.changes === 0) return { ok: false, error: "not-found" };
  return { ok: true, value: undefined };
}

export async function moveItem(
  deps: Deps,
  listId: ListId,
  itemId: ItemId,
  direction: MoveDirection,
): Promise<Result<void, "not-found">> {
  const rows = await deps.sql.all<ItemPositionRow>(
    `SELECT id, position
     FROM items
     WHERE list_id = ?
     ORDER BY position ASC, id ASC`,
    listId,
  );

  const index = rows.findIndex((row) => row.id === itemId);
  if (index === -1) return { ok: false, error: "not-found" };

  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= rows.length) {
    return { ok: true, value: undefined };
  }

  const current = rows[index];
  const neighbor = rows[targetIndex];
  if (!current || !neighbor) return { ok: true, value: undefined };

  rows[index] = neighbor;
  rows[targetIndex] = current;

  const updates: { sql: string; params: unknown[] }[] = [];
  for (let pos = 0; pos < rows.length; pos++) {
    const entry = rows[pos];
    if (!entry || entry.position === pos) continue;
    updates.push({
      sql: `UPDATE items SET position = ? WHERE id = ? AND list_id = ?`,
      params: [pos, entry.id, listId],
    });
  }

  if (updates.length > 0) {
    await deps.sql.batch(updates);
  }

  return { ok: true, value: undefined };
}
