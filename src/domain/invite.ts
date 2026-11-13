import type { Translate } from "../i18n/index.js";
import type { ShareLinks } from "../views/props.js";
import type { InviteToken } from "./types.js";

export function inviteUrl(appUrl: string, token: InviteToken): string {
  return `${appUrl.replace(/\/+$/, "")}/i/${token}`;
}

export function buildShareLinks(
  t: Translate,
  list: { title: string; ownerName: string },
  url: string,
): ShareLinks {
  const text = t("share.message", { owner: list.ownerName, title: list.title, link: url });
  return {
    text,
    url,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(text)}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
    mailto: `mailto:?subject=${encodeURIComponent(list.title)}&body=${encodeURIComponent(text)}`,
  };
}
