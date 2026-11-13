import type { LocaleCode, Translate } from "../i18n/index.js";
import type { GuestItem, ListRecord, OwnerItem, OwnerList, SideGift } from "../domain/types.js";

export type Chrome = {
  t: Translate;
  locale: LocaleCode;
  locales: { code: LocaleCode; name: string }[];
  path: string;
  // Set when someone is signed in. logoutAction is the POST target of the
  // sign-out button, for example "/logout" or "/l/<id>/logout".
  session: { name: string; logoutAction: string } | null;
};

export type ShareLinks = { text: string; url: string; whatsapp: string; telegram: string; mailto: string };

export type LandingPage = { chrome: Chrome };

export type SignupPage = {
  chrome: Chrome;
  captchaSiteKey: string | null;
  googleEnabled: boolean;
  values: { name: string; email: string };
  error?: "invalid" | "weak-password" | "email-taken" | "captcha" | "rate-limited" | undefined;
};

export type LoginPage = {
  chrome: Chrome;
  googleEnabled: boolean;
  email: string;
  error?: "invalid" | "wrong-credentials" | "throttled" | "google-failed" | undefined;
};

export type ForgotPage = {
  chrome: Chrome;
  captchaSiteKey: string | null;
  sent: boolean;
  error?: "invalid" | "captcha" | "rate-limited" | undefined;
};

export type ResetPage = {
  chrome: Chrome;
  token: string;
  state: "form" | "expired" | "done";
  error?: "weak-password" | undefined;
};

export type DashboardList = {
  id: string;
  title: string;
  occasionDate: string | null;
  daysLeft: number | null;
  itemCount: number;
};

export type DashboardPage = {
  chrome: Chrome;
  userName: string;
  lists: DashboardList[];
  flash?: "created" | "deleted" | "invalid" | "rate-limited" | "cap-reached" | undefined;
};

export type OwnerPage = {
  chrome: Chrome;
  list: OwnerList;
  items: OwnerItem[];
  totalCents: number;
  daysLeft: number | null;
  inviteUrl: string;
  share: ShareLinks;
  flash?: "invite-regenerated" | "invalid" | undefined;
};

export type InvitePage = {
  chrome: Chrome;
  list: ListRecord;
  token: string;
  captchaSiteKey: string | null;
  values: { firstName: string; lastName: string; email: string };
  registerError?: "invalid" | "email-taken" | "captcha" | "throttled" | "full" | undefined;
  loginError?: "invalid" | "wrong-credentials" | "throttled" | undefined;
};

export type GuestLoginPage = {
  chrome: Chrome;
  list: ListRecord;
  email: string;
  error?: "invalid" | "wrong-credentials" | "throttled" | undefined;
};

export type GuestListPage = {
  chrome: Chrome;
  list: ListRecord;
  guestName: string;
  items: GuestItem[];
  sideGifts: SideGift[];
  flash?: "already-taken" | "invalid" | undefined;
};
