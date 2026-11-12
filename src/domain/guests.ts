import { sendMail } from "../adapters/mail.js";
import type { Deps } from "../ports.js";
import {
  constantTimeEqual,
  generateInviteCode,
  generateInviteToken,
  generateSessionNonce,
  isGuestId,
  isInviteCode,
  isInviteToken,
  isSessionNonce,
  newGuestId,
} from "./auth.js";
import { composeGuestInviteMail } from "./invite.js";
import { getList } from "./lists.js";
import { DAY_MS, take, type RateRule } from "./rate.js";
import type {
  GuestId,
  InviteCode,
  InviteToken,
  ListId,
  ListRecord,
  OwnerGuest,
  Result,
  SessionNonce,
} from "./types.js";

export const MAX_GUESTS_PER_LIST = 200;
export const THROTTLE_MAX_FAILURES = 8;
export const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
export const GUEST_MAIL_DAILY_LIMIT = 30;

export type AddGuestInput = {
  name: string;
  email: string | null;
};

type OwnerGuestRow = {
  id: string;
  name: string;
  email: string | null;
  code: string;
  invite_token: string;
  joined_at: string | null;
};

type JoinGuestRow = {
  id: string;
  name: string;
  code: string;
  invite_token: string;
  session_nonce: string;
};

function toOwnerGuest(row: OwnerGuestRow): OwnerGuest | null {
  if (!isGuestId(row.id) || !isInviteCode(row.code) || !isInviteToken(row.invite_token)) {
    return null;
  }
  if (row.joined_at !== null) {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      joined: true,
      code: null,
      inviteToken: null,
    };
  }
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    joined: false,
    code: row.code,
    inviteToken: row.invite_token,
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
  guest: { email: string; code: InviteCode; inviteToken: InviteToken },
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
  const rows = await deps.sql.all<OwnerGuestRow>(
    `SELECT id, name, email, code, invite_token, joined_at
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
  const sessionNonce = generateSessionNonce();
  const createdAt = deps.now().toISOString();
  let chosenCode: InviteCode | null = null;
  let chosenToken: InviteToken | null = null;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInviteCode(usedCodes);
    const inviteToken = generateInviteToken();
    try {
      await deps.sql.run(
        `INSERT INTO guests (id, list_id, name, email, code, invite_token, session_nonce, joined_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        id,
        listId,
        input.name,
        input.email,
        code,
        inviteToken,
        sessionNonce,
        createdAt,
      );
      chosenCode = code;
      chosenToken = inviteToken;
      break;
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        usedCodes.add(code);
        continue;
      }
      throw err;
    }
  }

  if (!chosenCode || !chosenToken) {
    return { ok: false, error: "cap-reached" };
  }

  const guest: OwnerGuest = {
    id,
    name: input.name,
    email: input.email,
    code: chosenCode,
    inviteToken: chosenToken,
    joined: false,
  };

  let emailSent = true;
  if (input.email !== null) {
    emailSent = await sendGuestInviteIfAllowed(deps, listResult.value, {
      email: input.email,
      code: chosenCode,
      inviteToken: chosenToken,
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

  const guestRow = await deps.sql.first<OwnerGuestRow>(
    `SELECT id, name, email, code, invite_token, joined_at
     FROM guests
     WHERE id = ? AND list_id = ?`,
    guestId,
    listId,
  );
  if (
    !guestRow ||
    !isGuestId(guestRow.id) ||
    !isInviteCode(guestRow.code) ||
    !isInviteToken(guestRow.invite_token)
  ) {
    return { ok: false, error: "not-found" };
  }

  const existingRows = await deps.sql.all<{ code: string }>(
    `SELECT code FROM guests WHERE list_id = ?`,
    listId,
  );
  const usedCodes = new Set(existingRows.map((row) => row.code));
  usedCodes.add(guestRow.code);

  const nextNonce = generateSessionNonce();
  let nextCode: InviteCode | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateInviteCode(usedCodes);
    try {
      const res = await deps.sql.run(
        `UPDATE guests
         SET code = ?, session_nonce = ?, joined_at = NULL
         WHERE id = ? AND list_id = ?`,
        candidate,
        nextNonce,
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
    inviteToken: guestRow.invite_token,
  };

  let emailSent = true;
  if (updated.email !== null) {
    emailSent = await sendGuestInviteIfAllowed(deps, listResult.value, {
      email: updated.email,
      code: nextCode,
      inviteToken: guestRow.invite_token,
    });
  }

  return { ok: true, value: { guest: updated, emailSent } };
}

export async function getGuestForList(
  deps: Deps,
  listId: ListId,
  guestId: GuestId,
  sessionNonce: SessionNonce,
): Promise<Result<{ id: GuestId; name: string }, "not-found">> {
  const row = await deps.sql.first<{ id: string; name: string }>(
    `SELECT id, name
     FROM guests
     WHERE id = ? AND list_id = ? AND session_nonce = ? AND joined_at IS NOT NULL`,
    guestId,
    listId,
    sessionNonce,
  );
  if (!row || !isGuestId(row.id)) return { ok: false, error: "not-found" };
  return { ok: true, value: { id: row.id, name: row.name } };
}

export async function joinWithCode(
  deps: Deps,
  listId: ListId,
  rawInvite: string,
  rawCode: string,
  client: string,
): Promise<
  Result<
    { list: ListRecord; guestId: GuestId; guestName: string; sessionNonce: SessionNonce },
    "not-found" | "throttled" | "wrong-code" | "code-used"
  >
> {
  const listResult = await getList(deps, listId);
  if (!listResult.ok) return listResult;

  const trimmedInvite = rawInvite.trim();
  const guestRow = isInviteToken(trimmedInvite)
    ? await deps.sql.first<JoinGuestRow>(
        `SELECT id, name, code, invite_token, session_nonce
         FROM guests
         WHERE list_id = ? AND invite_token = ?`,
        listId,
        trimmedInvite,
      )
    : null;

  const listClientKey = `${listId}:${client}`;
  const tokenScope = guestRow ? `${listId}:${guestRow.invite_token}` : "";
  const rules: RateRule[] = [
    {
      kind: "join",
      scope: null,
      client: listClientKey,
      limit: THROTTLE_MAX_FAILURES,
      windowMs: THROTTLE_WINDOW_MS,
    },
  ];
  if (guestRow) {
    rules.push({
      kind: "join",
      scope: tokenScope,
      client: null,
      limit: THROTTLE_MAX_FAILURES,
      windowMs: THROTTLE_WINDOW_MS,
    });
  }

  const nowMs = deps.now().getTime();
  const ticket = await take(
    deps,
    { kind: "join", scope: tokenScope, client: listClientKey, at: nowMs },
    rules,
  );
  if (!ticket.ok) {
    return { ok: false, error: "throttled" };
  }

  const trimmedCode = rawCode.trim();
  const validFormat = isInviteCode(trimmedCode);
  const probe = validFormat ? trimmedCode : "0000";
  const targetCode = guestRow ? guestRow.code : "0000";
  const codeMatches = constantTimeEqual(targetCode, probe);

  if (
    !guestRow ||
    !validFormat ||
    !codeMatches ||
    !isGuestId(guestRow.id) ||
    !isInviteCode(guestRow.code) ||
    !isSessionNonce(guestRow.session_nonce)
  ) {
    return { ok: false, error: "wrong-code" };
  }

  const consumed = await deps.sql.run(
    `UPDATE guests
     SET joined_at = ?
     WHERE id = ? AND list_id = ? AND joined_at IS NULL`,
    deps.now().toISOString(),
    guestRow.id,
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
      guestId: guestRow.id,
      guestName: guestRow.name,
      sessionNonce: guestRow.session_nonce,
    },
  };
}
