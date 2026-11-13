import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  InviteToken,
  ItemId,
  ListId,
  ListRecord,
  OwnerList,
  SideGiftId,
} from "../src/domain/types.js";
import { LOCALES, type LocaleCode, translator } from "../src/i18n/index.js";
import {
  DashboardView,
  ForgotView,
  GuestListView,
  GuestLoginView,
  InviteView,
  LandingView,
  LoginView,
  OwnerView,
  ResetView,
  SignupView,
} from "../src/views/pages.js";
import type { Chrome, ShareLinks } from "../src/views/props.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = "/tmp/cumplista-preview";

function isListId(v: string): v is ListId {
  return v.length > 0;
}
function listId(v: string): ListId {
  if (!isListId(v)) throw new Error("invalid list id");
  return v;
}

function isItemId(v: string): v is ItemId {
  return v.length > 0;
}
function itemId(v: string): ItemId {
  if (!isItemId(v)) throw new Error("invalid item id");
  return v;
}

function isSideGiftId(v: string): v is SideGiftId {
  return v.length > 0;
}
function sideGiftId(v: string): SideGiftId {
  if (!isSideGiftId(v)) throw new Error("invalid side gift id");
  return v;
}

function isInviteToken(v: string): v is InviteToken {
  return /^[A-Za-z0-9_-]{22,64}$/.test(v);
}
function inviteToken(v: string): InviteToken {
  if (!isInviteToken(v)) throw new Error("invalid invite token");
  return v;
}

const localeOptions: { code: LocaleCode; name: string }[] = [
  { code: "en", name: LOCALES.en.name },
  { code: "es", name: LOCALES.es.name },
];

function makeChrome(
  locale: LocaleCode,
  path: string,
  session: Chrome["session"] = null,
): Chrome {
  return {
    t: translator(locale),
    locale,
    locales: localeOptions,
    path,
    session,
  };
}

function rewriteRelativeAssets(markup: string): string {
  return markup
    .replaceAll('href="/app.css"', 'href="./app.css"')
    .replaceAll('src="/app.js"', 'src="./app.js"')
    .replaceAll('href="/fonts/', 'href="./fonts/');
}

const genericToken = inviteToken("inv_marta30_token_12345678");
const genericUrl = `https://cumplista.example/i/${genericToken}`;

const listEn: ListRecord = {
  id: listId("lst_marta30"),
  title: "Marta's 30th birthday",
  ownerName: "Marta",
  locale: "en",
  occasionDate: "2026-11-28",
};

const listEs: ListRecord = {
  id: listId("lst_marta30"),
  title: "Los 30 de Marta",
  ownerName: "Marta",
  locale: "es",
  occasionDate: "2026-11-28",
};

const ownerListEn: OwnerList = { ...listEn, inviteToken: genericToken };
const ownerListEs: OwnerList = { ...listEs, inviteToken: genericToken };

function buildShare(locale: LocaleCode, owner: string, title: string, url: string): ShareLinks {
  const t = translator(locale);
  const text = t("share.message", { owner, title, link: url });
  const encText = encodeURIComponent(text);
  const encUrl = encodeURIComponent(url);
  return {
    text,
    url,
    whatsapp: `https://wa.me/?text=${encText}`,
    telegram: `https://t.me/share/url?url=${encUrl}&text=${encText}`,
    mailto: `mailto:?subject=${encodeURIComponent(title)}&body=${encText}`,
  };
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(resolve(repoRoot, "public"), outDir, { recursive: true });

const copiedCssPath = resolve(outDir, "app.css");
const cssContent = readFileSync(copiedCssPath, "utf8").replaceAll('url("/fonts/', 'url("./fonts/');
writeFileSync(copiedCssPath, cssContent, "utf8");

const ownerSession = { name: "Marta", logoutAction: "/logout" };
const guestSession = { name: "Diego Vega", logoutAction: "/l/lst_marta30/logout" };

const pages: Record<string, string> = {
  "landing-en.html": String(LandingView({ chrome: makeChrome("en", "/") }).toString()),
  "landing-es.html": String(LandingView({ chrome: makeChrome("es", "/") }).toString()),
  "signup-en.html": String(
    SignupView({
      chrome: makeChrome("en", "/signup"),
      captchaSiteKey: null,
      googleEnabled: true,
      values: { name: "", email: "" },
    }).toString(),
  ),
  "login-en.html": String(
    LoginView({
      chrome: makeChrome("en", "/login"),
      googleEnabled: true,
      email: "",
    }).toString(),
  ),
  "forgot-en.html": String(
    ForgotView({
      chrome: makeChrome("en", "/forgot"),
      captchaSiteKey: null,
      sent: false,
    }).toString(),
  ),
  "reset-en.html": String(
    ResetView({
      chrome: makeChrome("en", "/reset/tok_preview"),
      token: "tok_preview",
      state: "form",
    }).toString(),
  ),
  "dashboard-en.html": String(
    DashboardView({
      chrome: makeChrome("en", "/dashboard", ownerSession),
      userName: "Marta",
      lists: [
        {
          id: "lst_marta30",
          title: "Marta's 30th birthday",
          occasionDate: "2026-11-28",
          daysLeft: 15,
          itemCount: 4,
        },
        {
          id: "lst_kings",
          title: "Three Kings family dinner",
          occasionDate: "2027-01-06",
          daysLeft: 54,
          itemCount: 1,
        },
      ],
    }).toString(),
  ),
  "owner-en.html": String(
    OwnerView({
      chrome: makeChrome("en", "/o/lst_marta30", ownerSession),
      list: ownerListEn,
      totalCents: 22450,
      daysLeft: 15,
      inviteUrl: genericUrl,
      share: buildShare("en", "Marta", listEn.title, genericUrl),
      items: [
        {
          id: itemId("itm_kettle"),
          name: "Fellow Stagg pour-over kettle",
          priceCents: 8900,
          url: "https://fellowproducts.com/products/stagg-ekg",
          details: "Matte black, 0.9L electric version",
          received: false,
        },
        {
          id: itemId("itm_apron"),
          name: "Washed linen kitchen apron",
          priceCents: 4250,
          url: "https://linen.example.com/apron",
          details: "Moss green or terracotta, one size",
          received: false,
        },
        {
          id: itemId("itm_book"),
          name: "The Flavor Equation hardcover",
          priceCents: 3500,
          url: "https://bookshop.org",
          details: "English edition",
          received: true,
        },
        {
          id: itemId("itm_vase"),
          name: "Hand-thrown stoneware pitcher",
          priceCents: 5800,
          url: null,
          details: "Speckled oat glaze from the ceramic studio on Calle Pez",
          received: false,
        },
      ],
    }).toString(),
  ),
  "owner-es.html": String(
    OwnerView({
      chrome: makeChrome("es", "/o/lst_marta30", ownerSession),
      list: ownerListEs,
      totalCents: 12400,
      daysLeft: 15,
      flash: "invite-regenerated",
      inviteUrl: genericUrl,
      share: buildShare("es", "Marta", listEs.title, genericUrl),
      items: [
        {
          id: itemId("itm_kettle"),
          name: "Hervidor de cuello de cisne",
          priceCents: 8900,
          url: "https://fellowproducts.com/products/stagg-ekg",
          details: "Negro mate, modelo de 0,9 litros",
          received: false,
        },
        {
          id: itemId("itm_book"),
          name: "Atlas ilustrado del café",
          priceCents: 3500,
          url: "https://casadellibro.com",
          details: "Tapa dura",
          received: true,
        },
      ],
    }).toString(),
  ),
  "invite-en.html": String(
    InviteView({
      chrome: makeChrome("en", `/i/${genericToken}`),
      list: listEn,
      token: genericToken,
      captchaSiteKey: null,
      values: { firstName: "", lastName: "", email: "" },
    }).toString(),
  ),
  "invite-es.html": String(
    InviteView({
      chrome: makeChrome("es", `/i/${genericToken}`),
      list: listEs,
      token: genericToken,
      captchaSiteKey: null,
      values: { firstName: "", lastName: "", email: "" },
    }).toString(),
  ),
  "invite-signin-es.html": String(
    InviteView({
      chrome: makeChrome("es", `/i/${genericToken}`),
      list: listEs,
      token: genericToken,
      captchaSiteKey: null,
      values: { firstName: "Carlos", lastName: "García", email: "carlos@ejemplo.com" },
      registerError: "email-taken",
    }).toString(),
  ),
  "guest-login-en.html": String(
    GuestLoginView({
      chrome: makeChrome("en", "/l/lst_marta30"),
      list: listEn,
      email: "carlos@example.com",
    }).toString(),
  ),
  "guest-en.html": String(
    GuestListView({
      chrome: makeChrome("en", "/l/lst_marta30/list", guestSession),
      list: listEn,
      guestName: "Diego Vega",
      items: [
        {
          id: itemId("itm_free"),
          name: "Hand-thrown stoneware pitcher",
          priceCents: 5800,
          url: "https://ceramics.example.com/pitcher",
          details: "Speckled oat glaze from the ceramic studio on Calle Pez",
          received: false,
          state: { kind: "free" },
        },
        {
          id: itemId("itm_mine"),
          name: "Washed linen kitchen apron",
          priceCents: 4250,
          url: "https://linen.example.com/apron",
          details: "Moss green or terracotta, one size",
          received: false,
          state: { kind: "mine" },
        },
        {
          id: itemId("itm_taken"),
          name: "Fellow Stagg pour-over kettle",
          priceCents: 8900,
          url: "https://fellowproducts.com/products/stagg-ekg",
          details: "Matte black, 0.9L electric version",
          received: false,
          state: { kind: "taken", byName: "Lucía Ruiz" },
        },
        {
          id: itemId("itm_received"),
          name: "The Flavor Equation hardcover",
          priceCents: 3500,
          url: "https://bookshop.org",
          details: "English edition",
          received: true,
          state: { kind: "free" },
        },
      ],
      sideGifts: [
        {
          id: sideGiftId("sg_1"),
          name: "Vinyl LP of Buena Vista Social Club",
          priceCents: 3200,
          url: "https://records.example.com/bvsc",
          details: "180g remastered pressing",
          byName: "Diego Vega",
          mine: true,
        },
        {
          id: sideGiftId("sg_2"),
          name: "Box of Sicilian pistachio pastries",
          priceCents: 2400,
          url: "https://pastries.example.com",
          details: "Picking them up Saturday afternoon before the party",
          byName: "Elena Soto",
          mine: false,
        },
      ],
    }).toString(),
  ),
  "guest-es.html": String(
    GuestListView({
      chrome: makeChrome("es", "/l/lst_marta30/list", guestSession),
      list: listEs,
      guestName: "Diego Vega",
      flash: "already-taken",
      items: [
        {
          id: itemId("itm_free"),
          name: "Jarra artesanal de gres",
          priceCents: 5800,
          url: "https://ceramica.ejemplo.com/jarra",
          details: "Esmalte moteado color avena del taller de la calle Pez",
          received: false,
          state: { kind: "free" },
        },
        {
          id: itemId("itm_taken"),
          name: "Hervidor de cuello de cisne",
          priceCents: 8900,
          url: "https://fellowproducts.com/products/stagg-ekg",
          details: "Negro mate, modelo de 0,9 litros",
          received: false,
          state: { kind: "taken", byName: "Lucía Ruiz" },
        },
      ],
      sideGifts: [],
    }).toString(),
  ),
};

for (const [filename, htmlDoc] of Object.entries(pages)) {
  writeFileSync(resolve(outDir, filename), rewriteRelativeAssets(htmlDoc), "utf8");
}

process.stdout.write(`Wrote ${Object.keys(pages).length} preview files to ${outDir}\n`);
