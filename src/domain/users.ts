import { translator, type LocaleCode } from "../i18n/index.js";
import type { Deps, GoogleProfile } from "../ports.js";
import { isUserId, newUserId, randomToken, sha256Hex } from "./auth.js";
import { burnVerify, hashSecret, isValidPassword, verifySecret } from "./password.js";
import { take } from "./rate.js";
import type { Result, UserId, UserRecord } from "./types.js";

const HOUR_MS = 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const USER_COLUMNS = "id, email, name, password_hash, google_sub, session_epoch";

type UserRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  google_sub: string | null;
  session_epoch: number;
};

type SignedIn = { user: UserRecord; epoch: number };

function signedIn(row: UserRow): SignedIn {
  if (!isUserId(row.id)) throw new Error("Invalid stored user id");
  return {
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      hasPassword: row.password_hash !== null,
      hasGoogle: row.google_sub !== null,
    },
    epoch: row.session_epoch,
  };
}

export async function signupWithPassword(
  deps: Deps,
  input: { name: string; email: string; password: string },
  client: string,
  locale: LocaleCode,
): Promise<Result<SignedIn, "invalid" | "weak-password" | "email-taken" | "rate-limited">> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const ticket = await take(deps,
    { kind: "signup", scope: email, client, at: deps.now().getTime() },
    [{ kind: "signup", scope: null, client, limit: 5, windowMs: HOUR_MS }],
  );
  if (!ticket.ok) return { ok: false, error: "rate-limited" };
  if (!name || name.length > 120 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "invalid" };
  }
  if (!isValidPassword(input.password)) return { ok: false, error: "weak-password" };
  const passwordHash = await hashSecret(input.password);
  const row = await deps.sql.first<UserRow>(
    `INSERT INTO users (id, email, name, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING RETURNING ${USER_COLUMNS}`,
    newUserId(), email, name, passwordHash, deps.now().toISOString(),
  );
  if (!row) return { ok: false, error: "email-taken" };
  return { ok: true, value: signedIn(row) };
}

export async function loginWithPassword(
  deps: Deps,
  input: { email: string; password: string },
  client: string,
): Promise<Result<SignedIn, "wrong-credentials" | "throttled">> {
  const email = input.email.trim().toLowerCase();
  const ticket = await take(deps,
    { kind: "owner-login", scope: email, client, at: deps.now().getTime() },
    [
      { kind: "owner-login", scope: email, client: null, limit: 10, windowMs: HOUR_MS / 4 },
      { kind: "owner-login", scope: null, client, limit: 30, windowMs: HOUR_MS / 4 },
    ],
  );
  if (!ticket.ok) return { ok: false, error: "throttled" };
  const row = await deps.sql.first<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?`, email);
  if (!row || row.password_hash === null) {
    await burnVerify();
    return { ok: false, error: "wrong-credentials" };
  }
  if (!await verifySecret(input.password, row.password_hash)) {
    return { ok: false, error: "wrong-credentials" };
  }
  return { ok: true, value: signedIn(row) };
}

export async function getUserForPrincipal(
  deps: Deps,
  userId: UserId,
  epoch: number,
): Promise<UserRecord | null> {
  const row = await deps.sql.first<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = ? AND session_epoch = ?`, userId, epoch,
  );
  return row ? signedIn(row).user : null;
}

export async function requestPasswordReset(
  deps: Deps,
  email: string,
  client: string,
  locale: LocaleCode,
): Promise<Result<void, "rate-limited">> {
  email = email.trim().toLowerCase();
  const now = deps.now().getTime();
  const ticket = await take(deps,
    { kind: "password-reset", scope: email, client, at: now },
    [
      { kind: "password-reset", scope: email, client: null, limit: 3, windowMs: HOUR_MS },
      { kind: "password-reset", scope: null, client, limit: 10, windowMs: HOUR_MS },
    ],
  );
  if (!ticket.ok) return { ok: false, error: "rate-limited" };
  const user = await deps.sql.first<{ id: string }>("SELECT id FROM users WHERE email = ?", email);
  if (!user) return { ok: true, value: undefined };
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  await deps.sql.batch([
    { sql: "DELETE FROM password_resets WHERE user_id = ?", params: [user.id] },
    { sql: "INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
      params: [tokenHash, user.id, now + HOUR_MS] },
  ]);
  const t = translator(locale);
  const link = `${deps.env.APP_URL.replace(/\/+$/, "")}/reset/${token}`;
  const text = t("mail.reset_body", { link });
  const html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  try {
    await deps.mailer.send({ to: email, subject: t("mail.reset_subject"), text, html: `<p>${html}</p>` });
  } catch {
    // Delivery failure must not disclose whether the account exists.
  }
  return { ok: true, value: undefined };
}

export async function previewReset(deps: Deps, token: string): Promise<boolean> {
  if (!RESET_PATTERN.test(token)) return false;
  const row = await deps.sql.first<{ token_hash: string }>(
    "SELECT token_hash FROM password_resets WHERE token_hash = ? AND expires_at > ?",
    await sha256Hex(token), deps.now().getTime(),
  );
  return row !== null;
}

export async function completeReset(
  deps: Deps,
  token: string,
  password: string,
): Promise<Result<SignedIn, "expired" | "weak-password">> {
  if (!RESET_PATTERN.test(token)) return { ok: false, error: "expired" };
  if (!isValidPassword(password)) return { ok: false, error: "weak-password" };
  // Unknown tokens must not cost a PBKDF2 derivation, or anyone could burn CPU here.
  if (!(await previewReset(deps, token))) return { ok: false, error: "expired" };
  const passwordHash = await hashSecret(password);
  const tokenHash = await sha256Hex(token);
  // The batch consumes the token with the update; the unique salted hash identifies its winner.
  await deps.sql.batch([
    {
      sql: `UPDATE users SET password_hash = ?, session_epoch = session_epoch + 1
            WHERE id = (SELECT user_id FROM password_resets WHERE token_hash = ? AND expires_at > ?)`,
      params: [passwordHash, tokenHash, deps.now().getTime()],
    },
    {
      sql: `DELETE FROM password_resets
            WHERE user_id IN (SELECT id FROM users WHERE password_hash = ?)`,
      params: [passwordHash],
    },
  ]);
  const row = await deps.sql.first<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE password_hash = ?`, passwordHash,
  );
  return row ? { ok: true, value: signedIn(row) } : { ok: false, error: "expired" };
}

export async function signInWithGoogle(
  deps: Deps,
  profile: GoogleProfile,
  locale: LocaleCode,
): Promise<Result<SignedIn, "unverified-email">> {
  if (!profile.emailVerified) return { ok: false, error: "unverified-email" };
  const existing = await deps.sql.first<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE google_sub = ?`, profile.sub,
  );
  if (existing) return { ok: true, value: signedIn(existing) };
  const email = profile.email.trim().toLowerCase();
  let row: UserRow | null;
  try {
    row = await deps.sql.first<UserRow>(
      `INSERT INTO users (id, email, name, google_sub, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET google_sub = excluded.google_sub,
         password_hash = NULL, session_epoch = users.session_epoch + 1
       WHERE users.google_sub IS NOT excluded.google_sub
       RETURNING ${USER_COLUMNS}`,
      newUserId(), email, profile.name, profile.sub, deps.now().toISOString(),
    );
  } catch (error) {
    row = await deps.sql.first<UserRow>(
      `SELECT ${USER_COLUMNS} FROM users WHERE google_sub = ?`, profile.sub,
    );
    if (!row) throw error;
  }
  if (!row) {
    row = await deps.sql.first<UserRow>(
      `SELECT ${USER_COLUMNS} FROM users WHERE google_sub = ?`, profile.sub,
    );
  }
  if (!row) throw new Error("Google account was not saved");
  return { ok: true, value: signedIn(row) };
}
