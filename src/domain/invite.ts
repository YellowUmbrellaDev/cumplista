import { translator } from "../i18n/index.js";
import type { Mail } from "../ports.js";
import type { ShareLinks } from "../views/props.js";
import type { InviteCode, ListId, ListRecord } from "./types.js";

function baseAppUrl(appUrl: string): string {
  return appUrl.replace(/\/+$/, "");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function guestListUrl(appUrl: string, listId: ListId): string {
  return `${baseAppUrl(appUrl)}/l/${listId}`;
}

export function ownerManageUrl(appUrl: string, listId: ListId, ownerToken: string): string {
  return `${baseAppUrl(appUrl)}/o/${listId}?k=${encodeURIComponent(ownerToken)}`;
}

export function buildShareLinks(
  list: ListRecord,
  guest: { code: InviteCode; email: string | null },
  appUrl: string,
): ShareLinks {
  const t = translator(list.locale);
  const url = guestListUrl(appUrl, list.id);
  const text = t("invite.message", {
    owner: list.ownerName,
    title: list.title,
    link: url,
    code: guest.code,
  });
  const subject = t("invite.subject", {
    owner: list.ownerName,
    title: list.title,
  });
  const recipient = guest.email ? encodeURIComponent(guest.email) : "";

  return {
    text,
    url,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(text)}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
    mailto: `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`,
  };
}

export function composeOwnerMail(list: ListRecord, ownerToken: string, appUrl: string): Mail {
  const t = translator(list.locale);
  const link = ownerManageUrl(appUrl, list.id, ownerToken);
  const subject = t("invite.owner_subject", {
    title: list.title,
    owner: list.ownerName,
  });
  const text = t("invite.owner_message", {
    link,
    title: list.title,
    owner: list.ownerName,
  });
  const escapedLink = escapeHtml(link);

  return {
    to: list.ownerEmail,
    subject,
    text,
    html: `<p>${escapeHtml(text)}</p><p><a href="${escapedLink}">${escapedLink}</a></p>`,
  };
}

export function composeGuestInviteMail(
  list: ListRecord,
  guest: { email: string; code: InviteCode },
  appUrl: string,
): Mail {
  const t = translator(list.locale);
  const link = guestListUrl(appUrl, list.id);
  const subject = t("invite.subject", {
    owner: list.ownerName,
    title: list.title,
  });
  const text = t("invite.message", {
    owner: list.ownerName,
    title: list.title,
    link,
    code: guest.code,
  });
  const escapedLink = escapeHtml(link);

  return {
    to: guest.email,
    subject,
    text,
    html: `<p>${escapeHtml(text)}</p><p><a href="${escapedLink}">${escapedLink}</a></p>`,
  };
}
