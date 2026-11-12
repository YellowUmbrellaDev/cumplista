import { sendMail } from "../adapters/mail.js";
import type { Deps } from "../ports.js";
import {
  constantTimeEqual,
  generateInviteCode,
  isGuestId,
  isInviteCode,
  newGuestId,
} from "./auth.js";
import { composeGuestInviteMail } from "./invite.js";
import { getList } from "./lists.js";
import { DAY_MS, take } from "./rate.js";
import type {
  GuestId,
  InviteCode,
  ListId,
  ListRecord,
  OwnerGuest,
  Result,
} from "./types.js";

export const MAX_GUESTS_PER_LIST = 200;
export const THROTTLE_MAX_FAILURES = 8;
export const THROTTLE_WINDOW_MS = 10 * 60 * 1000;
export const THROTTLE_LIST_DAILY_LIMIT = 30;
export const GUEST_MAIL_DAILY_LIMIT = 30;

export type AddGuestInput = {
  name: string;
  email: string | null;
};

type GuestRow = {
  id: string;
  name: string;
  email: string | null;
  code: string;
  joined_at: string | null;
};

function toOwnerGuest(row: GuestRow): OwnerGuest | null {
  if (!isGuestId(row.id) || !isInviteCode(row.code)) return null;
  if (row.joined_at !== null) {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      joined: true,
      code: null,
    };
  }
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    joined: false,
    code: row.code,
  };
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Error &&
    /UNIQUE constraint failed|PRIMARY KEY constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(
      err.message,
    )
  );
}

async function sendGuestInviteIfAllowed(
  deps: Deps,
  list: ListRecord,
  guest: { email: string; code: InviteCode },
): Promise<boolean> {
  const nowMs = deps.now().getTime();
  const ticket = await take(
    deps,
    { kind: "guest-mail", scope: list.id, client: "", at: nowMs },
    [
      {
        kind: "guest-mail",
        scope: list.id,
        client: null,
        limit: GUEST_MAIL_DAILY_LIMIT,
        windowMs: DAY_MS,
      },
    ],
  );
  if (!ticket.ok) {
    return false;
  }
  const mail = composeGuestInviteMail(list, guest, deps.env.APP_URL);
  return sendMail(deps.mailer, mail);
}

export async function listOwnerGuests(deps: Deps, listId: ListId): Promise<OwnerGuest[]> {
  const rows = await deps.sql.all<GuestRow>(
    `SELECT id, name, email, code, joined_at
     FROM guests
     WHERE list_id = ?
     ORDER BY created_at ASC, rowid ASC`,
    listId,
  );
  const guests: OwnerGuest[] = [];
  for (const row of rows) {
    const guest = toOwnerGuest(row);
    if (guest) guests.push(guest);
  }
  return guests;
}

export async function addGuest(
  deps: Deps,
  listId: ListId,
  input: AddGuestInput,
): Promise<Result<{ guest: OwnerGuest; emailSent: boolean }, "not-found" | "cap-reached">> {
  const listResult = await getList(deps, listId);
  if (!listResult.ok) return listResult;

  const existingRows = await deps.sql.all<{ code: string }>(
    `SELECT code FROM guests WHERE list_id = ?`,
    listId,
  );
  if (existingRows.length >= MAX_GUESTS_PER_LIST) {
    return { ok: false, error: "cap-reached" };
  }

  const usedCodes = new Set(existingRows.map((row) => row.code));
  const id = newGuestId();
  const createdAt = deps.now().toISOString();
  let chosenCode: InviteCode | null = null;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInviteCode(usedCodes);
    try {
      await deps.sql.run(
        `INSERT INTO guests (id, list_id, name, email, code, joined_at, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?)`,
        id,
        listId,
        input.name,
        input.email,
        code,
        createdAt,
      );
      chosenCode = code;
      break;
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        usedCodes.add(code);
        continue;
      }
      throw err;
    }
  }

  if (!chosenCode) {
    return { ok: false, error: "cap-reached" };
  }

  const guest: OwnerGuest = {
    id,
    name: input.name,
    email: input.email,
    code: chosenCode,
    joined: false,
  };

  let emailSent = true;
  if (input.email !== null) {
    emailSent = await sendGuestInviteIfAllowed(deps, listResult.value, {
      email: input.email,
      code: chosenCode,
    });
  }

  return { ok: true, value: { guest, emailSent } };
}

export async function removeGuest(
  deps: Deps,
  listId: ListId,
  guestId: GuestId,
): Promise<Result<void, "not-found">> {
  const res = await deps.sql.run(
    `DELETE FROM guests WHERE id = ? AND list_id = ?`,
    guestId,
    listId,
  );
  if (res.changes === 0) return { ok: false, error: "not-found" };
  return { ok: true, value: undefined };
}

export async function regenerateGuestCode(
  deps: Deps,
  listId: ListId,
  guestId: GuestId,
): Promise<Result<{ guest: OwnerGuest; emailSent: boolean }, "not-found">> {
  const listResult = await getList(deps, listId);
  if (!listResult.ok) return listResult;

  const guestRow = await deps.sql.first<GuestRow>(
    `SELECT id, name, email, code, joined_at
     FROM guests
     WHERE id = ? AND list_id = ?`,
    guestId,
    listId,
  );
  if (!guestRow || !isGuestId(guestRow.id) || !isInviteCode(guestRow.code)) {
    return { ok: false, error: "not-found" };
  }

  const existingRows = await deps.sql.all<{ code: string }>(
    `SELECT code FROM guests WHERE list_id = ?`,
    listId,
  );
  const usedCodes = new Set(existingRows.map((row) => row.code));
  usedCodes.add(guestRow.code);

  let nextCode: InviteCode | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateInviteCode(usedCodes);
    try {
      const res = await deps.sql.run(
        `UPDATE guests SET code = ?, joined_at = NULL WHERE id = ? AND list_id = ?`,
        candidate,
        guestId,
        listId,
      );
      if (res.changes === 0) return { ok: false, error: "not-found" };
      nextCode = candidate;
      break;
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        usedCodes.add(candidate);
        continue;
      }
      throw err;
    }
  }

  if (!nextCode) return { ok: false, error: "not-found" };

  const updated: OwnerGuest = {
    id: guestRow.id,
    name: guestRow.name,
    email: guestRow.email,
    joined: false,
    code: nextCode,
  };

  let emailSent = true;
  if (updated.email !== null) {
    emailSent = await sendGuestInviteIfAllowed(deps, listResult.value, {
      email: updated.email,
      code: nextCode,
    });
  }

  return { ok: true, value: { guest: updated, emailSent } };
}

export async function getGuestForList(
  deps: Deps,
  listId: ListId,
  guestId: GuestId,
  code: InviteCode,
): Promise<Result<{ id: GuestId; name: string }, "not-found">> {
  const row = await deps.sql.first<{ id: string; name: string }>(
    `SELECT id, name FROM guests WHERE id = ? AND list_id = ? AND code = ?`,
    guestId,
    listId,
    code,
  );
  if (!row || !isGuestId(row.id)) return { ok: false, error: "not-found" };
  return { ok: true, value: { id: row.id, name: row.name } };
}

export async function joinWithCode(
  deps: Deps,
  listId: ListId,
  rawCode: string,
  client: string,
): Promise<
  Result<
    { list: ListRecord; guestId: GuestId; guestName: string; code: InviteCode },
    "not-found" | "throttled" | "wrong-code" | "code-used"
  >
> {
  const listResult = await getList(deps, listId);
  if (!listResult.ok) return listResult;

  const nowMs = deps.now().getTime();
  const ticket = await take(
    deps,
    { kind: "join", scope: listId, client, at: nowMs },
    [
      {
        kind: "join",
        scope: listId,
        client,
        limit: THROTTLE_MAX_FAILURES,
        windowMs: THROTTLE_WINDOW_MS,
      },
      {
        kind: "join",
        scope: listId,
        client: null,
        limit: THROTTLE_LIST_DAILY_LIMIT,
        windowMs: DAY_MS,
      },
    ],
  );
  if (!ticket.ok) {
    return { ok: false, error: "throttled" };
  }

  const trimmed = rawCode.trim();
  const validFormat = isInviteCode(trimmed);
  const probe = validFormat ? trimmed : "0000";

  const rows = await deps.sql.all<GuestRow>(
    `SELECT id, name, email, code, joined_at
     FROM guests
     WHERE list_id = ?`,
    listId,
  );

  if (rows.length === 0) {
    constantTimeEqual("0000", probe);
  }

  let matched: { id: GuestId; name: string; code: InviteCode } | null = null;
  for (const row of rows) {
    const equal = constantTimeEqual(row.code, probe);
    if (validFormat && equal && isGuestId(row.id) && isInviteCode(row.code)) {
      matched = { id: row.id, name: row.name, code: row.code };
    }
  }

  if (!matched) {
    return { ok: false, error: "wrong-code" };
  }

  const consumed = await deps.sql.run(
    `UPDATE guests
     SET joined_at = ?
     WHERE id = ? AND list_id = ? AND joined_at IS NULL`,
    deps.now().toISOString(),
    matched.id,
    listId,
  );
  if (consumed.changes === 0) {
    return { ok: false, error: "code-used" };
  }

  await ticket.value.release();

  return {
    ok: true,
    value: {
      list: listResult.value,
      guestId: matched.id,
      guestName: matched.name,
      code: matched.code,
    },
  };
}
