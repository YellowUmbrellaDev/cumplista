import type {
  GuestId,
  InviteToken,
  ItemId,
  ListId,
  Principal,
  SessionNonce,
  SideGiftId,
  UserId,
} from "./types.js";

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const TOKEN_128_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function utf8Bytes(input: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(input);
  const copy = new Uint8Array(encoded.byteLength);
  copy.set(encoded);
  return copy;
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(encoded: string): Uint8Array<ArrayBuffer> | null {
  if (!encoded || !BASE64URL_PATTERN.test(encoded)) return null;
  const padLength = (4 - (encoded.length % 4)) % 4;
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLength);
  try {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

export function randomToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export function isListId(value: unknown): value is ListId {
  return typeof value === "string" && SAFE_ID_PATTERN.test(value);
}

export function parseListId(value: unknown): ListId | null {
  return isListId(value) ? value : null;
}

export function newListId(): ListId {
  const id = randomToken(12);
  if (!isListId(id)) throw new Error("Generated invalid ListId");
  return id;
}

export function isItemId(value: unknown): value is ItemId {
  return typeof value === "string" && SAFE_ID_PATTERN.test(value);
}

export function parseItemId(value: unknown): ItemId | null {
  return isItemId(value) ? value : null;
}

export function newItemId(): ItemId {
  const id = randomToken(12);
  if (!isItemId(id)) throw new Error("Generated invalid ItemId");
  return id;
}

export function isGuestId(value: unknown): value is GuestId {
  return typeof value === "string" && SAFE_ID_PATTERN.test(value);
}

export function parseGuestId(value: unknown): GuestId | null {
  return isGuestId(value) ? value : null;
}

export function newGuestId(): GuestId {
  const id = randomToken(12);
  if (!isGuestId(id)) throw new Error("Generated invalid GuestId");
  return id;
}

export function isSideGiftId(value: unknown): value is SideGiftId {
  return typeof value === "string" && SAFE_ID_PATTERN.test(value);
}

export function parseSideGiftId(value: unknown): SideGiftId | null {
  return isSideGiftId(value) ? value : null;
}

export function newSideGiftId(): SideGiftId {
  const id = randomToken(12);
  if (!isSideGiftId(id)) throw new Error("Generated invalid SideGiftId");
  return id;
}

export function isInviteToken(value: unknown): value is InviteToken {
  return typeof value === "string" && TOKEN_128_PATTERN.test(value);
}

export function parseInviteToken(value: unknown): InviteToken | null {
  return isInviteToken(value) ? value : null;
}

export function generateInviteToken(): InviteToken {
  const token = randomToken(16);
  if (!isInviteToken(token)) throw new Error("Generated invalid InviteToken");
  return token;
}

export function isSessionNonce(value: unknown): value is SessionNonce {
  return typeof value === "string" && TOKEN_128_PATTERN.test(value);
}

export function generateSessionNonce(): SessionNonce {
  const nonce = randomToken(16);
  if (!isSessionNonce(nonce)) throw new Error("Generated invalid SessionNonce");
  return nonce;
}

export function constantTimeEqual(a: string, b: string): boolean {
  const aBytes = utf8Bytes(a);
  const bBytes = utf8Bytes(b);
  const maxLen = Math.max(aBytes.byteLength, bBytes.byteLength, 1);
  let diff = aBytes.byteLength ^ bBytes.byteLength;
  for (let i = 0; i < maxLen; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

export function isUserId(value: unknown): value is UserId {
  return typeof value === "string" && SAFE_ID_PATTERN.test(value);
}

export function parseUserId(value: unknown): UserId | null {
  return isUserId(value) ? value : null;
}

export function newUserId(): UserId {
  const id = randomToken(12);
  if (!isUserId(id)) throw new Error("Generated invalid UserId");
  return id;
}

export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", utf8Bytes(s));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    utf8Bytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function isPrincipal(value: unknown): value is Principal {
  if (typeof value !== "object" || value === null || !("role" in value)) return false;
  if (value.role === "owner") {
    return "userId" in value && isUserId(value.userId) &&
      "epoch" in value && typeof value.epoch === "number" &&
      Number.isSafeInteger(value.epoch) && value.epoch >= 0;
  }
  return value.role === "guest" &&
    "listId" in value && isListId(value.listId) &&
    "guestId" in value && isGuestId(value.guestId) &&
    "nonce" in value && isSessionNonce(value.nonce);
}

async function signPayload(value: unknown, secret: string): Promise<string> {
  const payload = toBase64Url(utf8Bytes(JSON.stringify(value)));
  const key = await importHmacKey(secret);
  const sigBuffer = await crypto.subtle.sign("HMAC", key, utf8Bytes(payload));
  return `${payload}.${toBase64Url(new Uint8Array(sigBuffer))}`;
}

async function verifyPayload(
  cookieValue: string | undefined,
  secret: string,
): Promise<unknown> {
  if (!cookieValue) return null;
  const dotIndex = cookieValue.indexOf(".");
  if (dotIndex <= 0 || cookieValue.indexOf(".", dotIndex + 1) !== -1) return null;

  const payloadPart = cookieValue.slice(0, dotIndex);
  const sigPart = cookieValue.slice(dotIndex + 1);
  const sigBytes = fromBase64Url(sigPart);
  const payloadBytes = fromBase64Url(payloadPart);
  if (!sigBytes || !payloadBytes) return null;

  const key = await importHmacKey(secret);
  const valid = await crypto.subtle.verify("HMAC", key, sigBytes, utf8Bytes(payloadPart));
  if (!valid) return null;

  try {
    return JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
}

export async function signPrincipal(p: Principal, secret: string): Promise<string> {
  return signPayload(p, secret);
}

export async function verifyPrincipal(raw: string | undefined, secret: string): Promise<Principal | null> {
  const value = await verifyPayload(raw, secret);
  return isPrincipal(value) ? value : null;
}

export async function signValue(payload: string, secret: string, ttlSeconds: number, now: Date): Promise<string> {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) throw new Error("Invalid cookie lifetime");
  return signPayload({ payload, expiresAt: now.getTime() + ttlSeconds * 1000 }, secret);
}

export async function verifyValue(signed: string | undefined, secret: string, now: Date): Promise<string | null> {
  const value = await verifyPayload(signed, secret);
  if (typeof value !== "object" || value === null ||
      !("payload" in value) || typeof value.payload !== "string" ||
      !("expiresAt" in value) || typeof value.expiresAt !== "number" ||
      !Number.isFinite(value.expiresAt) || value.expiresAt <= now.getTime()) return null;
  return value.payload;
}

export function ownerCookieName(): string {
  return "cp_owner";
}

export function guestCookieName(listId: ListId): string {
  return `cp_g_${listId}`;
}

export function isSameOrigin(originHeader: string | undefined, appUrl: string): boolean {
  if (originHeader === undefined) return true;
  try {
    return originHeader === new URL(appUrl).origin;
  } catch {
    return false;
  }
}
