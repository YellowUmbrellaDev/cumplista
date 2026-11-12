import type { LocaleCode, Translate } from "../i18n/index.js";
import type { GuestId, GuestItem, SideGift, ListRecord, OwnerGuest, OwnerItem } from "../domain/types.js";

export type Chrome = {
  t: Translate;
  locale: LocaleCode;
  locales: { code: LocaleCode; name: string }[];
  path: string;
};

export type ShareLinks = { text: string; url: string; whatsapp: string; telegram: string; mailto: string };

export type CreateListPage = { chrome: Chrome; error?: "invalid" | "rate-limited" | undefined };
export type CreatedPage = { chrome: Chrome; list: ListRecord; manageUrl: string; emailSent: boolean };
export type OwnerPage = {
  chrome: Chrome;
  list: ListRecord;
  items: OwnerItem[];
  guests: OwnerGuest[];
  totalCents: number;
  daysLeft: number | null;
  shares: Record<GuestId, ShareLinks>;
  flash?: "guest-added" | "mail-failed" | "invalid" | undefined;
};
export type JoinPage = {
  chrome: Chrome;
  list: ListRecord;
  invite: string | null;
  error?: "wrong-code" | "code-used" | "throttled" | undefined;
};
export type GuestListPage = {
  chrome: Chrome;
  list: ListRecord;
  guestName: string;
  items: GuestItem[];
  sideGifts: SideGift[];
  flash?: "already-taken" | "invalid" | undefined;
};
