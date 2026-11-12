import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  GuestId,
  InviteCode,
  InviteToken,
  ItemId,
  ListId,
  ListRecord,
  SideGiftId,
} from "../src/domain/types.js";
import { LOCALES, type LocaleCode, translator } from "../src/i18n/index.js";
import {
  CreateListView,
  CreatedView,
  GuestListView,
  JoinView,
  OwnerView,
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

function isGuestId(v: string): v is GuestId {
  return v.length > 0;
}
function guestId(v: string): GuestId {
  if (!isGuestId(v)) throw new Error("invalid guest id");
  return v;
}

function isSideGiftId(v: string): v is SideGiftId {
  return v.length > 0;
}
function sideGiftId(v: string): SideGiftId {
  if (!isSideGiftId(v)) throw new Error("invalid side gift id");
  return v;
}

function isInviteCode(v: string): v is InviteCode {
  return /^[0-9]{4}$/.test(v);
}
function inviteCode(v: string): InviteCode {
  if (!isInviteCode(v)) throw new Error("invalid invite code");
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

function makeChrome(locale: LocaleCode, path: string): Chrome {
  return {
    t: translator(locale),
    locale,
    locales: localeOptions,
    path,
  };
}

function rewriteRelativeAssets(markup: string): string {
  return markup
    .replaceAll('href="/app.css"', 'href="./app.css"')
    .replaceAll('src="/app.js"', 'src="./app.js"')
    .replaceAll('href="/fonts/', 'href="./fonts/');
}

const listEn: ListRecord = {
  id: listId("lst_marta30"),
  title: "Marta's 30th birthday",
  ownerName: "Marta",
  ownerEmail: "marta@example.com",
  locale: "en",
  occasionDate: "2026-11-28",
};

const listEs: ListRecord = {
  id: listId("lst_marta30"),
  title: "Los 30 de Marta",
  ownerName: "Marta",
  ownerEmail: "marta@ejemplo.com",
  locale: "es",
  occasionDate: "2026-11-28",
};

const gCarlos = guestId("gst_carlos");
const gLucia = guestId("gst_lucia");
const luciaToken = inviteToken("inv_lucia_token_12345678");

function buildShare(owner: string, title: string, token: InviteToken, code: string): ShareLinks {
  const url = `https://cumplista.example/l/lst_marta30?i=${encodeURIComponent(token)}`;
  const text = `${owner} invited you to their birthday gift list "${title}". Open ${url} and enter code ${code}.`;
  const encText = encodeURIComponent(text);
  const encUrl = encodeURIComponent(url);
  return {
    text,
    url,
    whatsapp: `https://wa.me/?text=${encText}`,
    telegram: `https://t.me/share/url?url=${encUrl}&text=${encText}`,
    mailto: `mailto:?subject=${encodeURIComponent(`${owner} invited you`)}&body=${encText}`,
  };
}

const sharesEn: Record<GuestId, ShareLinks> = {
  [gLucia]: buildShare("Marta", "Marta's 30th birthday", luciaToken, "9104"),
};

const sharesEs: Record<GuestId, ShareLinks> = {
  [gLucia]: buildShare("Marta", "Los 30 de Marta", luciaToken, "9104"),
};

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(resolve(repoRoot, "public"), outDir, { recursive: true });

const copiedCssPath = resolve(outDir, "app.css");
const cssContent = readFileSync(copiedCssPath, "utf8").replaceAll('url("/fonts/', 'url("./fonts/');
writeFileSync(copiedCssPath, cssContent, "utf8");

const pages: Record<string, string> = {
  "create-en.html": String(CreateListView({ chrome: makeChrome("en", "/") }).toString()),
  "create-es.html": String(CreateListView({ chrome: makeChrome("es", "/") }).toString()),
  "created-en.html": String(
    CreatedView({
      chrome: makeChrome("en", "/lists"),
      list: listEn,
      manageUrl: "https://cumplista.example/o/lst_marta30?k=8f92aBcDeFgHiJkLmNoPqRsTuVwXyZ01",
      emailSent: true,
    }).toString(),
  ),
  "owner-en.html": String(
    OwnerView({
      chrome: makeChrome("en", "/o/lst_marta30"),
      list: listEn,
      totalCents: 22450,
      daysLeft: 16,
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
      guests: [
        {
          id: gCarlos,
          name: "Carlos",
          email: "carlos@example.com",
          code: null,
          inviteToken: null,
          joined: true,
        },
        {
          id: gLucia,
          name: "Lucía",
          email: null,
          code: inviteCode("9104"),
          inviteToken: luciaToken,
          joined: false,
        },
      ],
      shares: sharesEn,
    }).toString(),
  ),
  "owner-es.html": String(
    OwnerView({
      chrome: makeChrome("es", "/o/lst_marta30"),
      list: listEs,
      totalCents: 22450,
      daysLeft: 16,
      flash: "guest-added",
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
      guests: [
        {
          id: gCarlos,
          name: "Carlos",
          email: "carlos@ejemplo.com",
          code: null,
          inviteToken: null,
          joined: true,
        },
        {
          id: gLucia,
          name: "Lucía",
          email: null,
          code: inviteCode("9104"),
          inviteToken: luciaToken,
          joined: false,
        },
      ],
      shares: sharesEs,
    }).toString(),
  ),
  "join-en.html": String(
    JoinView({ chrome: makeChrome("en", "/l/lst_marta30"), list: listEn, invite: luciaToken }).toString(),
  ),
  "join-error-es.html": String(
    JoinView({
      chrome: makeChrome("es", "/l/lst_marta30"),
      list: listEs,
      invite: luciaToken,
      error: "wrong-code",
    }).toString(),
  ),
  "guest-en.html": String(
    GuestListView({
      chrome: makeChrome("en", "/l/lst_marta30/list"),
      list: listEn,
      guestName: "Diego",
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
          state: { kind: "taken", byName: "Lucía" },
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
          byName: "Diego",
          mine: true,
        },
        {
          id: sideGiftId("sg_2"),
          name: "Box of Sicilian pistachio pastries",
          priceCents: 2400,
          url: "https://pastries.example.com",
          details: "Picking them up Saturday afternoon before the party",
          byName: "Elena",
          mine: false,
        },
        {
          id: sideGiftId("sg_3"),
          name: "Framed group photo from Asturias trip",
          priceCents: 2800,
          url: null,
          details: "Oak A4 frame with matte paper print",
          byName: "Carlos",
          mine: false,
        },
      ],
    }).toString(),
  ),
  "guest-es.html": String(
    GuestListView({
      chrome: makeChrome("es", "/l/lst_marta30/list"),
      list: listEs,
      guestName: "Diego",
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
          id: itemId("itm_mine"),
          name: "Delantal de lino lavado",
          priceCents: 4250,
          url: "https://lino.ejemplo.com/delantal",
          details: "Verde musgo, talla única",
          received: false,
          state: { kind: "mine" },
        },
        {
          id: itemId("itm_taken"),
          name: "Hervidor de cuello de cisne",
          priceCents: 8900,
          url: "https://fellowproducts.com/products/stagg-ekg",
          details: "Negro mate, modelo de 0,9 litros",
          received: false,
          state: { kind: "taken", byName: "Lucía" },
        },
        {
          id: itemId("itm_received"),
          name: "Atlas ilustrado del café",
          priceCents: 3500,
          url: "https://casadellibro.com",
          details: "Tapa dura",
          received: true,
          state: { kind: "taken", byName: "Carlos" },
        },
      ],
      sideGifts: [
        {
          id: sideGiftId("sg_1"),
          name: "Vinilo de Buena Vista Social Club",
          priceCents: 3200,
          url: "https://discos.ejemplo.com/bvsc",
          details: "Edición de 180 gramos",
          byName: "Diego",
          mine: true,
        },
        {
          id: sideGiftId("sg_2"),
          name: "Caja de dulces de pistacho",
          priceCents: 2400,
          url: null,
          details: "La llevo el sábado a la cena",
          byName: "Elena",
          mine: false,
        },
      ],
    }).toString(),
  ),
};

for (const [filename, htmlDoc] of Object.entries(pages)) {
  writeFileSync(resolve(outDir, filename), rewriteRelativeAssets(htmlDoc), "utf8");
}

console.log(`Wrote ${Object.keys(pages).length} preview files to ${outDir}`);
