import { constantTimeEqual, fromBase64Url, randomToken, toBase64Url } from "./auth.js";

const ITERATIONS = 100_000;
const DUMMY_HASH = "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

async function derive(secret: string, salt: Uint8Array<ArrayBuffer>): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, key, 256,
  );
  return toBase64Url(new Uint8Array(bits));
}

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomToken(16);
  const bytes = fromBase64Url(salt);
  if (!bytes) throw new Error("Invalid generated salt");
  return `pbkdf2$${ITERATIONS}$${salt}$${await derive(secret, bytes)}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  const salt = fromBase64Url(parts[2] ?? "");
  const hash = fromBase64Url(parts[3] ?? "");
  if (parts.length !== 4 || parts[0] !== "pbkdf2" || parts[1] !== String(ITERATIONS) ||
      !salt || salt.byteLength !== 16 || !hash || hash.byteLength !== 32) {
    await burnVerify();
    return false;
  }
  const candidate = await derive(secret, salt);
  return constantTimeEqual(candidate, toBase64Url(hash));
}

export async function burnVerify(): Promise<void> {
  await verifySecret("dummy password", DUMMY_HASH);
}

export function isValidPin(v: string): boolean {
  return /^[0-9]{4}$/.test(v);
}

export function isValidPassword(v: string): boolean {
  return v.length >= 10 && v.length <= 200;
}
