import type { Deps } from "../ports.js";
import { generateSessionNonce, isGuestId, isSessionNonce, newGuestId } from "./auth.js";
import { burnVerify, hashSecret, isValidPin, verifySecret } from "./password.js";
import { take } from "./rate.js";
import type { GuestId, ListId, Result, SessionNonce } from "./types.js";

export const MAX_GUESTS_PER_LIST = 200;

const HOUR_MS = 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const REGISTER_HOURLY_LIMIT = 10;
const LOGIN_EMAIL_LIMIT = 8;
const LOGIN_CLIENT_LIMIT = 20;
const MAX_GUEST_NAME_LENGTH = 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type RegisterGuestInput = {
  listId: ListId;
  firstName: string;
  lastName: string;
  email: string;
  pin: string;
};

export type LoginGuestInput = {
  listId: ListId;
  email: string;
  pin: string;
};

export type GuestSession = {
  guestId: GuestId;
  nonce: SessionNonce;
  displayName: string;
};

type GuestAuthRow = {
  id: string;
  first_name: string;
  last_name: string;
  pin_hash: string;
  session_nonce: string;
};

type GuestPrincipalRow = {
  id: string;
  first_name: string;
  last_name: string;
};

function formatDisplayName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`;
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Error &&
    /UNIQUE constraint failed|PRIMARY KEY constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(
      err.message,
    )
  );
}

export async function registerGuest(
  deps: Deps,
  input: RegisterGuestInput,
  client: string,
): Promise<Result<GuestSession, "invalid" | "email-taken" | "throttled" | "full">> {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const email = input.email.trim().toLowerCase();
  if (
    firstName.length < 1 ||
    firstName.length > MAX_GUEST_NAME_LENGTH ||
    lastName.length < 1 ||
    lastName.length > MAX_GUEST_NAME_LENGTH ||
    email.length < 3 ||
    email.length > 254 ||
    !EMAIL_PATTERN.test(email) ||
    !isValidPin(input.pin)
  ) {
    return { ok: false, error: "invalid" };
  }

  const listClient = `${input.listId}:${client}`;
  const ticket = await take(
    deps,
    { kind: "guest-register", scope: input.listId, client: listClient, at: deps.now().getTime() },
    [
      {
        kind: "guest-register",
        scope: null,
        client: listClient,
        limit: REGISTER_HOURLY_LIMIT,
        windowMs: HOUR_MS,
      },
    ],
  );
  if (!ticket.ok) {
    return { ok: false, error: "throttled" };
  }

  const existing = await deps.sql.first<{ id: string }>(
    `SELECT id FROM guests WHERE list_id = ? AND email = ?`,
    input.listId,
    email,
  );
  if (existing) {
    return { ok: false, error: "email-taken" };
  }

  const countRow = await deps.sql.first<{ count: number }>(
    `SELECT COUNT(*) AS count FROM guests WHERE list_id = ?`,
    input.listId,
  );
  if ((countRow?.count ?? 0) >= MAX_GUESTS_PER_LIST) {
    return { ok: false, error: "full" };
  }

  const pinHash = await hashSecret(input.pin);
  const guestId = newGuestId();
  const nonce = generateSessionNonce();
  const createdAt = deps.now().toISOString();

  let inserted: { changes: number };
  try {
    inserted = await deps.sql.run(
      `INSERT INTO guests (id, list_id, first_name, last_name, email, pin_hash, session_nonce, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?
       WHERE (SELECT COUNT(*) FROM guests WHERE list_id = ?) < ?`,
      guestId,
      input.listId,
      firstName,
      lastName,
      email,
      pinHash,
      nonce,
      createdAt,
      input.listId,
      MAX_GUESTS_PER_LIST,
    );
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return { ok: false, error: "email-taken" };
    }
    throw err;
  }

  if (inserted.changes === 0) {
    return { ok: false, error: "full" };
  }

  return {
    ok: true,
    value: {
      guestId,
      nonce,
      displayName: formatDisplayName(firstName, lastName),
    },
  };
}

export async function loginGuest(
  deps: Deps,
  input: LoginGuestInput,
  client: string,
): Promise<Result<GuestSession, "wrong-credentials" | "throttled">> {
  const email = input.email.trim().toLowerCase();
  const listEmail = `${input.listId}:${email}`;
  const listClient = `${input.listId}:${client}`;
  const ticket = await take(
    deps,
    { kind: "guest-login", scope: listEmail, client: listClient, at: deps.now().getTime() },
    [
      {
        kind: "guest-login",
        scope: listEmail,
        client: null,
        limit: LOGIN_EMAIL_LIMIT,
        windowMs: LOGIN_WINDOW_MS,
      },
      {
        kind: "guest-login",
        scope: null,
        client: listClient,
        limit: LOGIN_CLIENT_LIMIT,
        windowMs: LOGIN_WINDOW_MS,
      },
    ],
  );
  if (!ticket.ok) {
    return { ok: false, error: "throttled" };
  }

  const row = await deps.sql.first<GuestAuthRow>(
    `SELECT id, first_name, last_name, pin_hash, session_nonce
     FROM guests
     WHERE list_id = ? AND email = ?`,
    input.listId,
    email,
  );
  if (!row || !isValidPin(input.pin)) {
    await burnVerify();
    return { ok: false, error: "wrong-credentials" };
  }

  const valid = await verifySecret(input.pin, row.pin_hash);
  if (!valid || !isGuestId(row.id) || !isSessionNonce(row.session_nonce)) {
    return { ok: false, error: "wrong-credentials" };
  }

  return {
    ok: true,
    value: {
      guestId: row.id,
      nonce: row.session_nonce,
      displayName: formatDisplayName(row.first_name, row.last_name),
    },
  };
}

export async function getGuestForPrincipal(
  deps: Deps,
  listId: ListId,
  guestId: GuestId,
  nonce: SessionNonce,
): Promise<{ id: GuestId; displayName: string } | null> {
  const row = await deps.sql.first<GuestPrincipalRow>(
    `SELECT id, first_name, last_name
     FROM guests
     WHERE id = ? AND list_id = ? AND session_nonce = ?`,
    guestId,
    listId,
    nonce,
  );
  if (!row || !isGuestId(row.id)) {
    return null;
  }
  return {
    id: row.id,
    displayName: formatDisplayName(row.first_name, row.last_name),
  };
}
