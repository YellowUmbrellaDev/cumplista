import { sendMail } from "../adapters/mail.js";
import { DEFAULT_LOCALE, isLocale, type LocaleCode } from "../i18n/index.js";
import type { Deps } from "../ports.js";
import {
  constantTimeEqual,
  generateOwnerToken,
  hashOwnerToken,
  isItemId,
  isListId,
  newItemId,
  newListId,
} from "./auth.js";
import { composeOwnerMail, ownerManageUrl } from "./invite.js";
import { DAY_MS, take } from "./rate.js";
import type {
  ItemDraft,
  ItemId,
  ListId,
  ListRecord,
  OwnerItem,
  Result,
} from "./types.js";

export const MAX_ITEMS_PER_LIST = 500;
export const LIST_CREATE_HOURLY_LIMIT = 5;
export const LIST_CREATE_EMAIL_DAILY_LIMIT = 3;
export const HOUR_MS = 60 * 60 * 1000;

export type CreateListInput = {
  title: string;
  ownerName: string;
  ownerEmail: string;
  locale: LocaleCode;
  occasionDate: string | null;
};

export type MoveDirection = "up" | "down";
export type ReceivedMode = "toggle" | "received" | "unreceived";

type ListRow = {
  id: string;
  title: string;
  owner_name: string;
  owner_email: string;
  locale: string;
  occasion_date: string | null;
};

type ListWithHashRow = ListRow & {
  owner_token_hash: string;
};

type OwnerItemRow = {
  id: string;
  name: string;
  price_cents: number | null;
  url: string | null;
  details: string | null;
  received_at: string | null;
};

type ItemPositionRow = {
  id: string;
  position: number;
};

function toListRecord(row: ListRow): ListRecord | null {
  if (!isListId(row.id)) return null;
  return {
    id: row.id,
    title: row.title,
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    locale: isLocale(row.locale) ? row.locale : DEFAULT_LOCALE,
    occasionDate: row.occasion_date,
  };
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

export function computeDaysLeft(occasionDate: string | null, now: Date): number | null {
  if (!occasionDate) return null;
  const parts = occasionDate.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  const targetUtc = Date.UTC(year, month - 1, day);
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((targetUtc - todayUtc) / 86_400_000);
}

export async function createList(
  deps: Deps,
  input: CreateListInput,
  client: string,
): Promise<Result<{ list: ListRecord; manageUrl: string; emailSent: boolean }, "rate-limited">> {
  const nowMs = deps.now().getTime();
  const emailScope = input.ownerEmail.trim().toLowerCase();
  const ticket = await take(
    deps,
    { kind: "list-create", scope: emailScope, client, at: nowMs },
    [
      {
        kind: "list-create",
        scope: null,
        client,
        limit: LIST_CREATE_HOURLY_LIMIT,
        windowMs: HOUR_MS,
      },
      {
        kind: "list-create",
        scope: emailScope,
        client: null,
        limit: LIST_CREATE_EMAIL_DAILY_LIMIT,
        windowMs: DAY_MS,
      },
    ],
  );
  if (!ticket.ok) {
    return { ok: false, error: "rate-limited" };
  }

  const id = newListId();
  const ownerToken = generateOwnerToken();
  const ownerTokenHash = await hashOwnerToken(ownerToken);
  const createdAt = deps.now().toISOString();

  await deps.sql.run(
    `INSERT INTO lists (id, title, owner_name, owner_email, owner_token_hash, locale, occasion_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.title,
    input.ownerName,
    input.ownerEmail,
    ownerTokenHash,
    input.locale,
    input.occasionDate,
    createdAt,
  );

  const list: ListRecord = {
    id,
    title: input.title,
    ownerName: input.ownerName,
    ownerEmail: input.ownerEmail,
    locale: input.locale,
    occasionDate: input.occasionDate,
  };

  const manageUrl = ownerManageUrl(deps.env.APP_URL, id, ownerToken);
  const mail = composeOwnerMail(list, ownerToken, deps.env.APP_URL);
  const emailSent = await sendMail(deps.mailer, mail);

  return { ok: true, value: { list, manageUrl, emailSent } };
}

export async function verifyOwnerToken(
  deps: Deps,
  listId: ListId,
  token: string,
): Promise<Result<ListRecord, "not-found" | "invalid-token">> {
  const row = await deps.sql.first<ListWithHashRow>(
    `SELECT id, title, owner_name, owner_email, owner_token_hash, locale, occasion_date
     FROM lists
     WHERE id = ?`,
    listId,
  );
  if (!row) return { ok: false, error: "not-found" };

  const list = toListRecord(row);
  if (!list) return { ok: false, error: "not-found" };

  if (!token) return { ok: false, error: "invalid-token" };
  const candidateHash = await hashOwnerToken(token);
  if (!constantTimeEqual(candidateHash, row.owner_token_hash)) {
    return { ok: false, error: "invalid-token" };
  }

  return { ok: true, value: list };
}

export async function getList(
  deps: Deps,
  listId: ListId,
): Promise<Result<ListRecord, "not-found">> {
  const row = await deps.sql.first<ListRow>(
    `SELECT id, title, owner_name, owner_email, locale, occasion_date
     FROM lists
     WHERE id = ?`,
    listId,
  );
  if (!row) return { ok: false, error: "not-found" };
  const list = toListRecord(row);
  if (!list) return { ok: false, error: "not-found" };
  return { ok: true, value: list };
}

export async function getOwnerListView(
  deps: Deps,
  listId: ListId,
): Promise<
  Result<
    {
      list: ListRecord;
      items: OwnerItem[];
      totalCents: number;
      daysLeft: number | null;
    },
    "not-found"
  >
> {
  const listResult = await getList(deps, listId);
  if (!listResult.ok) return listResult;

  const itemRows = await deps.sql.all<OwnerItemRow>(
    `SELECT id, name, price_cents, url, details, received_at
     FROM items
     WHERE list_id = ?
     ORDER BY position ASC, id ASC`,
    listId,
  );

  const items: OwnerItem[] = [];
  let totalCents = 0;
  for (const row of itemRows) {
    const item = toOwnerItem(row);
    if (!item) continue;
    items.push(item);
    totalCents += item.priceCents ?? 0;
  }

  return {
    ok: true,
    value: {
      list: listResult.value,
      items,
      totalCents,
      daysLeft: computeDaysLeft(listResult.value.occasionDate, deps.now()),
    },
  };
}

export async function addItem(
  deps: Deps,
  listId: ListId,
  draft: ItemDraft,
): Promise<Result<OwnerItem, "not-found" | "cap-reached">> {
  const listResult = await getList(deps, listId);
  if (!listResult.ok) return listResult;

  const countRow = await deps.sql.first<{ count: number }>(
    `SELECT COUNT(*) AS count FROM items WHERE list_id = ?`,
    listId,
  );
  if ((countRow?.count ?? 0) >= MAX_ITEMS_PER_LIST) {
    return { ok: false, error: "cap-reached" };
  }

  const id = newItemId();
  await deps.sql.run(
    `INSERT INTO items (id, list_id, name, price_cents, url, details, position, received_at)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(position) + 1 FROM items WHERE list_id = ?), 0), NULL)`,
    id,
    listId,
    draft.name,
    draft.priceCents,
    draft.url,
    draft.details,
    listId,
  );

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
