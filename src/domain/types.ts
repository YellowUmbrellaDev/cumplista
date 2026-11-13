import type { LocaleCode } from "../i18n/index.js";

export type UserId = string & { readonly __brand: "UserId" };
export type ListId = string & { readonly __brand: "ListId" };
export type ItemId = string & { readonly __brand: "ItemId" };
export type GuestId = string & { readonly __brand: "GuestId" };
export type SideGiftId = string & { readonly __brand: "SideGiftId" };
export type SessionNonce = string & { readonly __brand: "SessionNonce" };
export type InviteToken = string & { readonly __brand: "InviteToken" };

export type ItemDraft = {
  name: string;
  priceCents: number | null;
  url: string | null;
  details: string | null;
};

export type UserRecord = {
  id: UserId;
  email: string;
  name: string;
  hasPassword: boolean;
  hasGoogle: boolean;
};

// What a guest may know about a list. No invite token, no owner email.
export type ListRecord = {
  id: ListId;
  title: string;
  ownerName: string;
  locale: LocaleCode;
  occasionDate: string | null;
};

// What the owner sees of their own list. inviteToken is the generic link.
export type OwnerList = ListRecord & { inviteToken: InviteToken };

// The privacy boundary is the type system and the module graph. OwnerItem has
// no claim field, and owner modules never reference guests, claims or
// side_gifts. Do not add guest data to anything the owner path returns.
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

// A gift a guest added outside the owner's list. Only guests see it.
export type SideGift = ItemDraft & { id: SideGiftId; byName: string; mine: boolean };

export type Principal =
  | { role: "owner"; userId: UserId; epoch: number }
  | { role: "guest"; listId: ListId; guestId: GuestId; nonce: SessionNonce };

export type MailOutcome = "sent" | "failed" | "capped";

export type Result<T, E extends string> =
  | { ok: true; value: T }
  | { ok: false; error: E };
