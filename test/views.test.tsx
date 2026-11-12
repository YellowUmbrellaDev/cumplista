import { describe, expect, it } from "vitest";
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

function makeChrome(locale: LocaleCode, path = "/o/lst_1"): Chrome {
  const entries = (Object.keys(LOCALES) as LocaleCode[]).map((code) => ({
    code,
    name: LOCALES[code].name,
  }));
  return {
    t: translator(locale),
    locale,
    locales: entries,
    path,
  };
}

const sampleListEn: ListRecord = {
  id: listId("lst_1"),
  title: "Marta's 30th",
  ownerName: "Marta",
  ownerEmail: "marta@example.com",
  locale: "en",
  occasionDate: "2026-12-05",
};

const sampleListEs: ListRecord = {
  id: listId("lst_1"),
  title: "Los 30 de Marta",
  ownerName: "Marta",
  ownerEmail: "marta@ejemplo.com",
  locale: "es",
  occasionDate: "2026-12-05",
};

describe("views HTML output", () => {
  it("renders CreateListView in English and Spanish with document shell and locale switcher", () => {
    const enHtml = String(
      (
        <CreateListView
          chrome={makeChrome("en", "/")}
          error="invalid"
        />
      ).toString(),
    );
    expect(enHtml.startsWith('<!DOCTYPE html><html lang="en">')).toBe(true);
    expect(enHtml).toContain('<link rel="stylesheet" href="/app.css"');
    expect(enHtml).toContain('<script src="/app.js" defer');
    expect(enHtml).not.toMatch(/<script(?![^>]*src=)/i);
    expect(enHtml).toContain("Make a birthday list without spoiling the surprise");
    expect(enHtml).toContain("Check the highlighted fields and try again.");
    expect(enHtml).toContain('action="/lists"');
    expect(enHtml).toContain('name="title"');
    expect(enHtml).toContain('name="ownerName"');
    expect(enHtml).toContain('name="ownerEmail"');
    expect(enHtml).toContain('name="occasionDate"');
    expect(enHtml).toContain('action="/lang"');
    expect(enHtml).toContain('name="back" value="/"');
    expect(enHtml).toContain('name="lang" value="en"');
    expect(enHtml).toContain(">English<");
    expect(enHtml).toContain('name="lang" value="es"');
    expect(enHtml).toContain(">Español<");

    const esHtml = String(
      (
        <CreateListView
          chrome={makeChrome("es", "/")}
          error="invalid"
        />
      ).toString(),
    );
    expect(esHtml.startsWith('<!DOCTYPE html><html lang="es">')).toBe(true);
    expect(esHtml).toContain("Haz tu lista de cumpleaños sin arruinar la sorpresa");
    expect(esHtml).toContain("Revisa los campos marcados e inténtalo de nuevo.");
    expect(esHtml).toContain("Crear lista de regalos");

    const rateEnHtml = String(
      (<CreateListView chrome={makeChrome("en", "/")} error="rate-limited" />).toString(),
    );
    expect(rateEnHtml).toContain("Too many requests. Try again in a while.");

    const rateEsHtml = String(
      (<CreateListView chrome={makeChrome("es", "/")} error="rate-limited" />).toString(),
    );
    expect(rateEsHtml).toContain("Demasiadas solicitudes. Inténtalo de nuevo más tarde.");
  });

  it("iterates chrome.locales dynamically in the footer switcher", () => {
    const base = makeChrome("en", "/l/lst_1");
    const customChrome: Chrome = {
      ...base,
      locales: [
        ...base.locales,
        { code: "en", name: "TestExtraLocale" },
      ],
    };
    const out = String(
      (
        <JoinView
          chrome={customChrome}
          list={sampleListEn}
          invite="tok_guest_invite_123456"
        />
      ).toString(),
    );
    expect(out).toContain(">English<");
    expect(out).toContain(">Español<");
    expect(out).toContain(">TestExtraLocale<");
    expect(out).toContain('name="back" value="/l/lst_1"');
  });

  it("renders CreatedView with private manage link and progressive copy button", () => {
    const manageUrl = "https://cumplista.example/o/lst_1?k=secret_tok_123";
    const sentHtml = String(
      (
        <CreatedView
          chrome={makeChrome("en", "/lists")}
          list={sampleListEn}
          manageUrl={manageUrl}
          emailSent={true}
        />
      ).toString(),
    );
    expect(sentHtml).toContain("Your gift list is ready");
    expect(sentHtml).toContain("We sent your private link to marta@example.com.");
    expect(sentHtml).toContain(`value="${manageUrl}"`);
    expect(sentHtml).toContain(`href="${manageUrl}"`);
    expect(sentHtml).toContain(`data-share-copy`);
    expect(sentHtml).toContain(`data-share-text="${manageUrl}"`);
    expect(sentHtml).toContain("hidden");

    const unsentEsHtml = String(
      (
        <CreatedView
          chrome={makeChrome("es", "/lists")}
          list={sampleListEs}
          manageUrl={manageUrl}
          emailSent={false}
        />
      ).toString(),
    );
    expect(unsentEsHtml).toContain("Tu lista de regalos está lista");
    expect(unsentEsHtml).toContain("No pudimos enviar el correo ahora mismo.");
    expect(unsentEsHtml).toContain("Abrir mi lista");
  });

  it("renders OwnerView with item CRUD, share links only for unjoined guests, and zero claim or idea markers", () => {
    const g1 = guestId("gst_1");
    const g2 = guestId("gst_2");
    const inviteText =
      'Marta invited you to their birthday gift list "Marta\'s 30th". Open https://cumplista.example/l/lst_1 and enter code 4829.';
    const encodedInvite = encodeURIComponent(inviteText);
    const shareUrl = "https://cumplista.example/l/lst_1";
    const encodedUrl = encodeURIComponent(shareUrl);

    const shares: Record<GuestId, ShareLinks> = {
      [g1]: {
        text: inviteText,
        url: shareUrl,
        whatsapp: `https://wa.me/?text=${encodedInvite}`,
        telegram: `https://t.me/share/url?url=${encodedUrl}&text=${encodedInvite}`,
        mailto: `mailto:carlos@example.com?subject=Invite&body=${encodedInvite}`,
      },
    };

    const ownerHtml = String(
      (
        <OwnerView
          chrome={makeChrome("en", "/o/lst_1")}
          list={sampleListEn}
          totalCents={8450}
          daysLeft={12}
          flash="guest-added"
          items={[
            {
              id: itemId("itm_1"),
              name: "Pour-over kettle",
              priceCents: 5950,
              url: "https://shop.example.com/kettle",
              details: "Matte black 0.8L",
              received: false,
            },
            {
              id: itemId("itm_2"),
              name: "Olive oil tin",
              priceCents: 2500,
              url: null,
              details: null,
              received: true,
            },
          ]}
          guests={[
            {
              id: g1,
              name: "Carlos",
              email: "carlos@example.com",
              code: inviteCode("4829"),
              inviteToken: inviteToken("tok_carlos_123456789012"),
              joined: false,
            },
            {
              id: g2,
              name: "Lucia",
              email: "lucia@example.com",
              code: null,
              inviteToken: null,
              joined: true,
            },
          ]}
          shares={shares}
        />
      ).toString(),
    );

    expect(ownerHtml).toContain("12 days left");
    expect(ownerHtml).toContain("$84.50");
    expect(ownerHtml).toContain('action="/o/lst_1/items"');
    expect(ownerHtml).toContain('action="/o/lst_1/items/itm_1/received"');
    expect(ownerHtml).toContain('action="/o/lst_1/items/itm_1"');
    expect(ownerHtml).toContain('action="/o/lst_1/items/itm_1/delete"');
    expect(ownerHtml).toContain('action="/o/lst_1/items/itm_1/move"');
    expect(ownerHtml).toContain('action="/o/lst_1/guests"');
    expect(ownerHtml).toContain('action="/o/lst_1/guests/gst_1/code"');
    expect(ownerHtml).toContain('action="/o/lst_1/guests/gst_1/delete"');
    expect(ownerHtml).toContain('action="/o/lst_1/guests/gst_2/code"');
    expect(ownerHtml).toContain('action="/o/lst_1/guests/gst_2/delete"');
    expect(ownerHtml).toContain("Code 4829");
    expect(ownerHtml).toContain("Not opened yet");
    expect(ownerHtml).toContain("Joined");
    expect(ownerHtml).not.toContain("mailto:lucia@example.com");
    const htmlEncodedInvite = encodedInvite.replaceAll("'", "&#39;");
    expect(ownerHtml).toContain(`https://wa.me/?text=${htmlEncodedInvite}`);
    expect(ownerHtml).toContain(
      `https://t.me/share/url?url=${encodedUrl}&amp;text=${htmlEncodedInvite}`,
    );
    expect(ownerHtml).toContain(
      `mailto:carlos@example.com?subject=Invite&amp;body=${htmlEncodedInvite}`,
    );
    expect(ownerHtml).toContain("data-share-native");
    expect(ownerHtml).toContain("data-share-copy");
    expect(ownerHtml).toContain(`data-share-url="${shareUrl}"`);
    expect(ownerHtml).toContain("data-share-text=");

    const lower = ownerHtml.toLowerCase();
    expect(lower).not.toContain("taken");
    expect(lower).not.toContain("claim");
    expect(lower).not.toContain("idea");
    expect(lower).not.toContain("sidegift");
    expect(lower).not.toContain("side-gift");
    expect(lower).not.toContain("side_gift");

    const ownerEsHtml = String(
      (
        <OwnerView
          chrome={makeChrome("es", "/o/lst_1")}
          list={sampleListEs}
          totalCents={8450}
          daysLeft={12}
          items={[]}
          guests={[]}
          shares={{}}
        />
      ).toString(),
    );
    expect(ownerEsHtml).toContain("Faltan 12 días");
    expect(ownerEsHtml).toContain("84,50");
    expect(ownerEsHtml).toContain("Tu lista está vacía.");
    expect(ownerEsHtml.toLowerCase()).not.toContain("taken");
    expect(ownerEsHtml.toLowerCase()).not.toContain("claim");
    expect(ownerEsHtml.toLowerCase()).not.toContain("idea");
  });

  it("renders JoinView with hidden invite token, missing-invite disabled state, and localized error states", () => {
    const wrongEn = String(
      (
        <JoinView
          chrome={makeChrome("en", "/l/lst_1")}
          list={sampleListEn}
          invite="tok_guest_invite_123456"
          error="wrong-code"
        />
      ).toString(),
    );
    expect(wrongEn).toContain('action="/l/lst_1/join"');
    expect(wrongEn).toContain('name="invite" value="tok_guest_invite_123456"');
    expect(wrongEn).toContain('name="code"');
    expect(wrongEn).toContain("That code does not match. Check it with whoever invited you.");

    const missingEn = String(
      (
        <JoinView
          chrome={makeChrome("en", "/l/lst_1")}
          list={sampleListEn}
          invite={null}
        />
      ).toString(),
    );
    expect(missingEn).toContain(
      "Open the personal invite link that Marta sent you to enter your 4-digit code.",
    );
    expect(missingEn).not.toContain('name="invite"');
    expect(missingEn).toContain("disabled");

    const missingEs = String(
      (
        <JoinView
          chrome={makeChrome("es", "/l/lst_1")}
          list={sampleListEs}
          invite={null}
        />
      ).toString(),
    );
    expect(missingEs).toContain(
      "Abre el enlace personal de invitación que te envió Marta para introducir tu código de 4 cifras.",
    );
    expect(missingEs).not.toContain('name="invite"');
    expect(missingEs).toContain("disabled");

    const throttledEs = String(
      (
        <JoinView
          chrome={makeChrome("es", "/l/lst_1")}
          list={sampleListEs}
          invite="tok_guest_invite_123456"
          error="throttled"
        />
      ).toString(),
    );
    expect(throttledEs).toContain("Demasiados códigos incorrectos. Inténtalo de nuevo en unos minutos.");

    const usedEn = String(
      (
        <JoinView
          chrome={makeChrome("en", "/l/lst_1")}
          list={sampleListEn}
          invite="tok_guest_invite_123456"
          error="code-used"
        />
      ).toString(),
    );
    expect(usedEn).toContain("That code was already used. Ask Marta for a new one.");

    const usedEs = String(
      (
        <JoinView
          chrome={makeChrome("es", "/l/lst_1")}
          list={sampleListEs}
          invite="tok_guest_invite_123456"
          error="code-used"
        />
      ).toString(),
    );
    expect(usedEs).toContain("Ese código ya se usó. Pídele a Marta uno nuevo.");
  });

  it("renders GuestListView states, hidden accessible wrapped label, received state, and guest ideas", () => {
    const guestHtml = String(
      (
        <GuestListView
          chrome={makeChrome("en", "/l/lst_1/list")}
          list={sampleListEn}
          guestName="Diego"
          flash="already-taken"
          items={[
            {
              id: itemId("itm_free"),
              name: "Ceramic mug",
              priceCents: 2200,
              url: "https://mug.example.com/item",
              details: "Speckled glaze",
              received: false,
              state: { kind: "free" },
            },
            {
              id: itemId("itm_mine"),
              name: "Linen apron",
              priceCents: 3800,
              url: null,
              details: "Moss green",
              received: false,
              state: { kind: "mine" },
            },
            {
              id: itemId("itm_taken"),
              name: "Analog camera",
              priceCents: 9500,
              url: "https://camera.example.com",
              details: "35mm point and shoot",
              received: false,
              state: { kind: "taken", byName: "Lucía" },
            },
            {
              id: itemId("itm_rec"),
              name: "Wool scarf",
              priceCents: 4500,
              url: null,
              details: null,
              received: true,
              state: { kind: "mine" },
            },
          ]}
          sideGifts={[
            {
              id: sideGiftId("sg_mine"),
              name: "Concert tickets",
              priceCents: 6000,
              url: "https://tickets.example.com",
              details: "Two seats row 8",
              byName: "Diego",
              mine: true,
            },
            {
              id: sideGiftId("sg_other"),
              name: "Homemade pistachio cake",
              priceCents: 1800,
              url: "https://bakery.example.com",
              details: "Bringing it to Saturday dinner",
              byName: "Elena",
              mine: false,
            },
          ]}
        />
      ).toString(),
    );

    expect(guestHtml).toContain("Someone else just took that gift.");
    expect(guestHtml).toContain("For Marta. Signed in as Diego.");

    expect(guestHtml).toContain('action="/l/lst_1/items/itm_free/claim"');
    expect(guestHtml).toContain('action="/l/lst_1/items/itm_mine/unclaim"');
    expect(guestHtml).toContain('<span class="gift-tag is-mint">');
    expect(guestHtml).toContain(">You<");

    expect(guestHtml).toContain('<span class="sr-only">Analog camera, wrapped gift claimed by Lucía</span>');
    expect(guestHtml).toContain("Analog camera");
    expect(guestHtml).toContain(">Lucía<");
    expect(guestHtml).not.toContain("/l/lst_1/items/itm_taken/claim");
    expect(guestHtml).not.toContain("/l/lst_1/items/itm_taken/unclaim");

    expect(guestHtml).toContain(">Received<");
    expect(guestHtml).not.toContain("/l/lst_1/items/itm_rec/claim");
    expect(guestHtml).not.toContain("/l/lst_1/items/itm_rec/unclaim");

    expect(guestHtml).toContain(
      "Other guests see these gifts so nobody buys the same thing, and Marta never sees them.",
    );
    expect(guestHtml).toContain('action="/l/lst_1/ideas"');
    expect(guestHtml).toContain("Concert tickets");
    expect(guestHtml).toContain("From Diego, your gift");
    expect(guestHtml).toContain('action="/l/lst_1/ideas/sg_mine"');
    expect(guestHtml).toContain('action="/l/lst_1/ideas/sg_mine/delete"');

    expect(guestHtml).toContain("Homemade pistachio cake");
    expect(guestHtml).toContain("From Elena");
    expect(guestHtml).toContain("Bringing it to Saturday dinner");
    expect(guestHtml).not.toContain('action="/l/lst_1/ideas/sg_other"');
    expect(guestHtml).not.toContain('action="/l/lst_1/ideas/sg_other/delete"');

    const guestEsEmpty = String(
      (
        <GuestListView
          chrome={makeChrome("es", "/l/lst_1/list")}
          list={sampleListEs}
          guestName="Diego"
          flash="invalid"
          items={[
            {
              id: itemId("itm_taken"),
              name: "Cámara analógica",
              priceCents: 9500,
              url: null,
              details: null,
              received: false,
              state: { kind: "taken", byName: "Lucía" },
            },
          ]}
          sideGifts={[]}
        />
      ).toString(),
    );
    expect(guestEsEmpty).toContain("Revisa los campos marcados e inténtalo de nuevo.");
    expect(guestEsEmpty).toContain(
      '<span class="sr-only">Cámara analógica, regalo envuelto reservado por Lucía</span>',
    );
    expect(guestEsEmpty).toContain(">Lucía<");
    expect(guestEsEmpty).toContain(
      "El resto de invitados ve estos regalos para no comprar lo mismo, y Marta nunca los ve.",
    );
    expect(guestEsEmpty).toContain(
      "¿Vas a comprar algo que no está en la lista? Añádelo arriba para que nadie lo repita.",
    );
  });
});
