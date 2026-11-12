import type { Deps } from "../ports.js";
import { isGuestId, isSideGiftId, newSideGiftId } from "./auth.js";
import type {
  GuestId,
  ItemDraft,
  ListId,
  Result,
  SideGift,
  SideGiftId,
} from "./types.js";

export const MAX_IDEAS_PER_GUEST = 50;

type SideGiftRow = {
  id: string;
  guest_id: string;
  name: string;
  price_cents: number | null;
  url: string | null;
  details: string | null;
  author_name: string;
};

function toSideGift(row: SideGiftRow, viewerId: GuestId): SideGift | null {
  if (!isSideGiftId(row.id) || !isGuestId(row.guest_id)) return null;
  return {
    id: row.id,
    name: row.name,
    priceCents: row.price_cents,
    url: row.url,
    details: row.details,
    byName: row.author_name,
    mine: row.guest_id === viewerId,
  };
}

export async function listSideGifts(
  deps: Deps,
  listId: ListId,
  guestId: GuestId,
): Promise<SideGift[]> {
  const rows = await deps.sql.all<SideGiftRow>(
    `SELECT
       s.id,
       s.guest_id,
       s.name,
       s.price_cents,
       s.url,
       s.details,
       g.name AS author_name
     FROM side_gifts s
     JOIN guests g ON g.id = s.guest_id
     WHERE s.list_id = ?
     ORDER BY s.created_at ASC, s.rowid ASC`,
    listId,
  );

  const gifts: SideGift[] = [];
  for (const row of rows) {
    const gift = toSideGift(row, guestId);
    if (gift) gifts.push(gift);
  }
  return gifts;
}

export async function addSideGift(
  deps: Deps,
  listId: ListId,
  guestId: GuestId,
  draft: ItemDraft,
): Promise<Result<SideGift, "not-found" | "cap-reached">> {
  const guestRow = await deps.sql.first<{ name: string }>(
    `SELECT name FROM guests WHERE id = ? AND list_id = ?`,
    guestId,
    listId,
  );
  if (!guestRow) return { ok: false, error: "not-found" };

  const countRow = await deps.sql.first<{ count: number }>(
    `SELECT COUNT(*) AS count FROM side_gifts WHERE list_id = ? AND guest_id = ?`,
    listId,
    guestId,
  );
  if ((countRow?.count ?? 0) >= MAX_IDEAS_PER_GUEST) {
    return { ok: false, error: "cap-reached" };
  }

  const id = newSideGiftId();
  await deps.sql.run(
    `INSERT INTO side_gifts (id, list_id, guest_id, name, price_cents, url, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    listId,
    guestId,
    draft.name,
    draft.priceCents,
    draft.url,
    draft.details,
    deps.now().toISOString(),
  );

  return {
    ok: true,
    value: {
      id,
      ...draft,
      byName: guestRow.name,
      mine: true,
    },
  };
}

export async function updateSideGift(
  deps: Deps,
  listId: ListId,
  ideaId: SideGiftId,
  guestId: GuestId,
  draft: ItemDraft,
): Promise<Result<void, "not-found">> {
  const res = await deps.sql.run(
    `UPDATE side_gifts
     SET name = ?, price_cents = ?, url = ?, details = ?
     WHERE id = ? AND list_id = ? AND guest_id = ?`,
    draft.name,
    draft.priceCents,
    draft.url,
    draft.details,
    ideaId,
    listId,
    guestId,
  );
  if (res.changes === 0) return { ok: false, error: "not-found" };
  return { ok: true, value: undefined };
}

export async function deleteSideGift(
  deps: Deps,
  listId: ListId,
  ideaId: SideGiftId,
  guestId: GuestId,
): Promise<Result<void, "not-found">> {
  const res = await deps.sql.run(
    `DELETE FROM side_gifts
     WHERE id = ? AND list_id = ? AND guest_id = ?`,
    ideaId,
    listId,
    guestId,
  );
  if (res.changes === 0) return { ok: false, error: "not-found" };
  return { ok: true, value: undefined };
}
