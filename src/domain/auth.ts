import type {
  GuestId,
  InviteCode,
  ItemId,
  ListId,
  Principal,
  SideGiftId,
} from "./types.js";

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const INVITE_CODE_PATTERN = /^[0-9]{4}$/;
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

function randomBase64Url(byteLength: number): string {
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
  const id = randomBase64Url(12);
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
  const id = randomBase64Url(12);
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
  const id = randomBase64Url(12);
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
  const id = randomBase64Url(12);
  if (!isSideGiftId(id)) throw new Error("Generated invalid SideGiftId");
  return id;
}

export function isInviteCode(value: unknown): value is InviteCode {
  return typeof value === "string" && INVITE_CODE_PATTERN.test(value);
}

export function parseInviteCode(value: unknown): InviteCode | null {
  return isInviteCode(value) ? value : null;
}

export function generateInviteCode(existing: ReadonlySet<string> = new Set()): InviteCode {
  if (existing.size >= 10_000) {
    throw new Error("Invite code space exhausted");
  }
  const buf = new Uint16Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const sample = buf[0];
    // 60000 is the largest multiple of 10000 below 65536, so rejecting >= 60000 avoids modulo bias.
    if (sample === undefined || sample >= 60_000) continue;
    const candidate = String(sample % 10_000).padStart(4, "0");
    if (existing.has(candidate)) continue;
    if (isInviteCode(candidate)) return candidate;
  }
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

export function generateOwnerToken(): string {
  return randomBase64Url(32);
}

export async function hashOwnerToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", utf8Bytes(token));
  return toBase64Url(new Uint8Array(digest));
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
  if (typeof value !== "object" || value === null) return false;
  if (!("role" in value) || !("listId" in value) || !isListId(value.listId)) return false;
  if (value.role === "owner") return true;
  if (value.role === "guest") {
    return (
      "guestId" in value &&
      isGuestId(value.guestId) &&
      "code" in value &&
      isInviteCode(value.code)
    );
  }
  return false;
}

export async function signPrincipal(principal: Principal, secret: string): Promise<string> {
  const payload = toBase64Url(utf8Bytes(JSON.stringify(principal)));
  const key = await importHmacKey(secret);
  const sigBuffer = await crypto.subtle.sign("HMAC", key, utf8Bytes(payload));
  return `${payload}.${toBase64Url(new Uint8Array(sigBuffer))}`;
}

export async function verifyPrincipal(
  cookieValue: string | undefined,
  secret: string,
): Promise<Principal | null> {
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
    const decoded: unknown = JSON.parse(new TextDecoder().decode(payloadBytes));
    return isPrincipal(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function ownerCookieName(listId: ListId): string {
  return `o_${listId}`;
}

export function guestCookieName(listId: ListId): string {
  return `g_${listId}`;
}

export function isSameOrigin(originHeader: string | undefined, appUrl: string): boolean {
  if (originHeader === undefined) return true;
  try {
    return originHeader === new URL(appUrl).origin;
  } catch {
    return false;
  }
}
