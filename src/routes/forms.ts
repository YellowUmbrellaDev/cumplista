import type { ItemDraft, Result } from "../domain/types.js";
import type { MoveDirection, ReceivedMode } from "../domain/lists.js";
import { formString } from "./http.js";

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const PRICE_PATTERN = /^(\d{1,7})(?:[.,](\d{1,2}))?$/;

export function parseOccasionDate(raw: string): Result<string | null, "invalid"> {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  const match = ISO_DATE_PATTERN.exec(trimmed);
  if (!match) return { ok: false, error: "invalid" };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return { ok: false, error: "invalid" };
  }
  return { ok: true, value: trimmed };
}

function parsePriceCents(raw: string): Result<number | null, "invalid"> {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  const match = PRICE_PATTERN.exec(trimmed);
  if (!match) return { ok: false, error: "invalid" };
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  return { ok: true, value: whole * 100 + fraction };
}

function parseHttpUrl(raw: string): Result<string | null, "invalid"> {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (trimmed.length > 2048) return { ok: false, error: "invalid" };
  try {
    const parsed = new URL(trimmed);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
      return { ok: false, error: "invalid" };
    }
    return { ok: true, value: trimmed };
  } catch {
    return { ok: false, error: "invalid" };
  }
}

export function parseItemDraftForm(form: URLSearchParams): Result<ItemDraft, "invalid"> {
  const name = formString(form, "name").trim();
  if (name.length < 1 || name.length > 120) return { ok: false, error: "invalid" };

  const priceResult = parsePriceCents(formString(form, "price"));
  if (!priceResult.ok) return priceResult;

  const urlResult = parseHttpUrl(formString(form, "url"));
  if (!urlResult.ok) return urlResult;

  const detailsRaw = formString(form, "details").trim();
  if (detailsRaw.length > 1000) return { ok: false, error: "invalid" };

  return {
    ok: true,
    value: {
      name,
      priceCents: priceResult.value,
      url: urlResult.value,
      details: detailsRaw === "" ? null : detailsRaw,
    },
  };
}

export function parseMoveDirection(
  form: URLSearchParams,
  queryDir: string | undefined,
): Result<MoveDirection, "invalid"> {
  const raw = (
    formString(form, "direction") ||
    formString(form, "dir") ||
    formString(form, "move") ||
    formString(form, "delta") ||
    queryDir ||
    ""
  )
    .trim()
    .toLowerCase();

  if (raw === "up" || raw === "-1") return { ok: true, value: "up" };
  if (raw === "down" || raw === "1" || raw === "+1") return { ok: true, value: "down" };
  return { ok: false, error: "invalid" };
}

export function parseReceivedMode(form: URLSearchParams): Result<ReceivedMode, "invalid"> {
  if (!form.has("received")) return { ok: true, value: "toggle" };
  const raw = formString(form, "received").trim().toLowerCase();
  if (raw === "") return { ok: true, value: "toggle" };
  if (raw === "1" || raw === "true" || raw === "on") return { ok: true, value: "received" };
  if (raw === "0" || raw === "false" || raw === "off") return { ok: true, value: "unreceived" };
  return { ok: false, error: "invalid" };
}
