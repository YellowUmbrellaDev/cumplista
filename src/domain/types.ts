import type { LocaleCode } from "../i18n/index.js";

export type ListId = string & { readonly __brand: "ListId" };
export type ItemId = string & { readonly __brand: "ItemId" };
export type GuestId = string & { readonly __brand: "GuestId" };
export type InviteCode = string & { readonly __brand: "InviteCode" };

export type ItemDraft = {
  name: string;
  priceCents: number | null;
  url: string | null;
  details: string | null;
};

export type ListRecord = {
  id: ListId;
  title: string;
  ownerName: string;
  ownerEmail: string;
  locale: LocaleCode;
  occasionDate: string | null;
};

// The privacy boundary is the type system. OwnerItem has no claim field and no
// service the owner can reach returns one. Do not add claim data to it.
export type OwnerItem = ItemDraft & { id: ItemId; received: boolean };

export type GuestItemState =
  | { kind: "free" }
  | { kind: "mine" }
  | { kind: "taken"; byName: string };

export type GuestItem = ItemDraft & {
  id: ItemId;
  received: boolean;
  state: GuestItemState;
};

export type OwnerGuest = {
  id: GuestId;
  name: string;
  email: string | null;
  code: InviteCode;
  joined: boolean;
};

export type Principal =
  | { role: "owner"; listId: ListId }
  | { role: "guest"; listId: ListId; guestId: GuestId };

export type Result<T, E extends string> =
  | { ok: true; value: T }
  | { ok: false; error: E };
