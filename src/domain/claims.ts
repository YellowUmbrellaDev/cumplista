import type { Deps } from "../ports.js";
import { isGuestId, isItemId } from "./auth.js";
import type {
  GuestId,
  GuestItem,
  GuestItemState,
  ItemId,
  ListId,
  Result,
} from "./types.js";

type GuestItemRow = {
  id: string;
  name: string;
  price_cents: number | null;
  url: string | null;
  details: string | null;
  received_at: string | null;
  claimer_id: string | null;
  claimer_name: string | null;
};

function toGuestItem(row: GuestItemRow, viewerId: GuestId): GuestItem | null {
  if (!isItemId(row.id)) return null;

  let state: GuestItemState;
  if (row.claimer_id === null) {
    state = { kind: "free" };
  } else if (isGuestId(row.claimer_id) && row.claimer_id === viewerId) {
    state = { kind: "mine" };
  } else {
    state = { kind: "taken", byName: row.claimer_name ?? "" };
  }

  return {
    id: row.id,
    name: row.name,
    priceCents: row.price_cents,
    url: row.url,
    details: row.details,
    received: row.received_at !== null,
    state,
  };
}

function isPrimaryKeyConflict(err: unknown): boolean {
  return (
    err instanceof Error &&
    /UNIQUE constraint failed|PRIMARY KEY constraint failed|SQLITE_CONSTRAINT_PRIMARYKEY|SQLITE_CONSTRAINT_UNIQUE/i.test(
      err.message,
    )
  );
}

function isForeignKeyConflict(err: unknown): boolean {
  return (
    err instanceof Error &&
    /FOREIGN KEY constraint failed|SQLITE_CONSTRAINT_FOREIGNKEY/i.test(err.message)
  );
}

export async function listGuestItems(
  deps: Deps,
  listId: ListId,
  guestId: GuestId,
): Promise<GuestItem[]> {
  const rows = await deps.sql.all<GuestItemRow>(
    `SELECT
       i.id,
       i.name,
       i.price_cents,
       i.url,
       i.details,
       i.received_at,
       c.guest_id AS claimer_id,
       g.name AS claimer_name
     FROM items i
     LEFT JOIN claims c ON c.item_id = i.id
     LEFT JOIN guests g ON g.id = c.guest_id
     WHERE i.list_id = ?
     ORDER BY i.position ASC, i.id ASC`,
    listId,
  );

  const items: GuestItem[] = [];
  for (const row of rows) {
    const item = toGuestItem(row, guestId);
    if (item) items.push(item);
  }
  return items;
}

export async function claimItem(
  deps: Deps,
  listId: ListId,
  itemId: ItemId,
  guestId: GuestId,
): Promise<Result<void, "not-found" | "received" | "already-taken">> {
  const guestRow = await deps.sql.first<{ id: string }>(
    `SELECT id FROM guests WHERE id = ? AND list_id = ?`,
    guestId,
    listId,
  );
  if (!guestRow) return { ok: false, error: "not-found" };

  const itemRow = await deps.sql.first<{ id: string; received_at: string | null }>(
    `SELECT id, received_at FROM items WHERE id = ? AND list_id = ?`,
    itemId,
    listId,
  );
  if (!itemRow) return { ok: false, error: "not-found" };
  if (itemRow.received_at !== null) return { ok: false, error: "received" };

  try {
    await deps.sql.run(
      `INSERT INTO claims (item_id, guest_id, created_at) VALUES (?, ?, ?)`,
      itemId,
      guestId,
      deps.now().toISOString(),
    );
    return { ok: true, value: undefined };
  } catch (err) {
    if (isPrimaryKeyConflict(err)) {
      return { ok: false, error: "already-taken" };
    }
    if (isForeignKeyConflict(err)) {
      return { ok: false, error: "not-found" };
    }
    throw err;
  }
}

export async function unclaimItem(
  deps: Deps,
  listId: ListId,
  itemId: ItemId,
  guestId: GuestId,
): Promise<Result<void, "not-found" | "received">> {
  const itemRow = await deps.sql.first<{ id: string; received_at: string | null }>(
    `SELECT id, received_at FROM items WHERE id = ? AND list_id = ?`,
    itemId,
    listId,
  );
  if (!itemRow) return { ok: false, error: "not-found" };
  if (itemRow.received_at !== null) return { ok: false, error: "received" };

  await deps.sql.run(
    `DELETE FROM claims WHERE item_id = ? AND guest_id = ?`,
    itemId,
    guestId,
  );
  return { ok: true, value: undefined };
}
