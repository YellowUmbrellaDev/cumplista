import { describe, expect, it } from "vitest";
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
  TurnstileWidget,
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

const localeEntries: { code: LocaleCode; name: string }[] = [
  { code: "en", name: LOCALES.en.name },
  { code: "es", name: LOCALES.es.name },
];

function makeChrome(
  locale: LocaleCode,
  path = "/",
  session: Chrome["session"] = null,
): Chrome {
  return {
    t: translator(locale),
    locale,
    locales: localeEntries,
    path,
    session,
  };
}

const sampleToken = inviteToken("inv_marta_token_1234567890");
const sampleInviteUrl = `https://cumplista.example/i/${sampleToken}`;

const sampleListEn: ListRecord = {
  id: listId("lst_1"),
  title: "Marta's 30th",
  ownerName: "Marta",
  locale: "en",
  occasionDate: "2026-12-05",
};

const sampleListEs: ListRecord = {
  id: listId("lst_1"),
  title: "Los 30 de Marta",
  ownerName: "Marta",
  locale: "es",
  occasionDate: "2026-12-05",
};

const sampleOwnerListEn: OwnerList = { ...sampleListEn, inviteToken: sampleToken };
const sampleOwnerListEs: OwnerList = { ...sampleListEs, inviteToken: sampleToken };

function assertNoOwnerLeakWords(html: string) {
  const lower = html.toLowerCase();
  expect(lower).not.toContain("taken");
  expect(lower).not.toContain("claim");
  expect(lower).not.toContain("idea");
  expect(lower).not.toContain("sidegift");
  expect(lower).not.toContain("side-gift");
  expect(lower).not.toContain("side_gift");
}

describe("views and locales contract", () => {
  it("provides required cross-slice locale keys and neutral Spanish copy", () => {
    const tEn = translator("en");
    const tEs = translator("es");

    expect(tEn("mail.reset_subject")).toBe("Reset your Cumplista password");
    expect(tEs("mail.reset_subject")).toBe("Restablecer tu contraseña de Cumplista");

    expect(tEn("mail.reset_body", { link: "https://cumplista.example/reset/abc" })).toBe(
      "Open this link within 1 hour to set a new password: https://cumplista.example/reset/abc",
    );
    expect(tEs("mail.reset_body", { link: "https://cumplista.example/reset/abc" })).toBe(
      "Abre este enlace en la próxima hora para elegir una contraseña nueva: https://cumplista.example/reset/abc",
    );

    expect(
      tEn("share.message", {
        owner: "Marta",
        title: "Marta's 30th",
        link: sampleInviteUrl,
      }),
    ).toBe(`Marta invited you to the gift list "Marta's 30th": ${sampleInviteUrl}`);
    expect(
      tEs("share.message", {
        owner: "Marta",
        title: "Los 30 de Marta",
        link: sampleInviteUrl,
      }),
    ).toBe(`Marta te invitó a la lista de regalos "Los 30 de Marta": ${sampleInviteUrl}`);

    expect(Object.keys(LOCALES.es.messages).sort()).toEqual(
      Object.keys(LOCALES.en.messages).sort(),
    );

    for (const value of Object.values(LOCALES.es.messages)) {
      expect(value.toLowerCase()).not.toMatch(/\bcog(er|e|ió|ido|ida|iendo)\b/);
    }
  });

  it("renders Layout header auth links when signed out, session logout when signed in, and dynamic locale switcher", () => {
    const signedOutHtml = String((<LandingView chrome={makeChrome("en", "/")} />).toString());
    expect(signedOutHtml.startsWith('<!DOCTYPE html><html lang="en">')).toBe(true);
    expect(signedOutHtml).toContain('<link rel="stylesheet" href="/app.css"');
    expect(signedOutHtml).toContain('<script src="/app.js" defer');
    expect(signedOutHtml).not.toMatch(/<script(?![^>]*src=)/i);
    expect(signedOutHtml).toContain('href="/login"');
    expect(signedOutHtml).toContain(">Log in<");
    expect(signedOutHtml).toContain('href="/signup"');
    expect(signedOutHtml).toContain(">Sign up<");
    expect(signedOutHtml).not.toContain(">Sign out<");

    const signedInOwner = makeChrome("es", "/dashboard", {
      name: "Marta Ruiz",
      logoutAction: "/logout",
    });
    const customChrome: Chrome = {
      ...signedInOwner,
      locales: [...signedInOwner.locales, { code: "en", name: "TestExtraLocale" }],
    };
    const signedInHtml = String((<LandingView chrome={customChrome} />).toString());
    expect(signedInHtml.startsWith('<!DOCTYPE html><html lang="es">')).toBe(true);
    expect(signedInHtml).toContain(">Marta Ruiz<");
    expect(signedInHtml).toContain('method="post" action="/logout"');
    expect(signedInHtml).toContain(">Cerrar sesión<");
    expect(signedInHtml).toContain('action="/lang"');
    expect(signedInHtml).toContain('name="back" value="/dashboard"');
    expect(signedInHtml).toContain(">English<");
    expect(signedInHtml).toContain(">Español<");
    expect(signedInHtml).toContain(">TestExtraLocale<");
  });

  it("renders LandingView in English and Spanish", () => {
    const enHtml = String((<LandingView chrome={makeChrome("en", "/")} />).toString());
    expect(enHtml).toContain("Make a birthday gift list without spoiling the surprise");
    expect(enHtml).toContain("How it works");
    expect(enHtml).toContain(">Create account<");
    expect(enHtml).toContain(">Log in<");

    const esHtml = String((<LandingView chrome={makeChrome("es", "/")} />).toString());
    expect(esHtml).toContain("Haz tu lista de cumpleaños sin arruinar la sorpresa");
    expect(esHtml).toContain("Cómo funciona");
    expect(esHtml).toContain(">Crear cuenta<");
    expect(esHtml).toContain(">Iniciar sesión<");
  });

  it("renders TurnstileWidget and SignupView in English and Spanish with exact fields, Google toggle, and errors", () => {
    expect(TurnstileWidget({ siteKey: null })).toBeNull();
    expect(String((<TurnstileWidget siteKey={null} />).toString())).toBe("");
    expect(String((<TurnstileWidget siteKey="ts_site_abc" />).toString())).toBe(
      '<div class="cf-turnstile" data-sitekey="ts_site_abc" data-appearance="interaction-only"></div>',
    );

    const enHtml = String(
      (
        <SignupView
          chrome={makeChrome("en", "/signup")}
          captchaSiteKey="ts_key_1"
          googleEnabled={true}
          values={{ name: "Marta", email: "marta@example.com" }}
          error="weak-password"
        />
      ).toString(),
    );
    expect(enHtml).toContain(
      '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async',
    );
    expect(enHtml).toContain("defer");
    expect(enHtml).toContain(
      '<div class="cf-turnstile" data-sitekey="ts_key_1" data-appearance="interaction-only"></div>',
    );
    expect(enHtml).toContain('href="/auth/google"');
    expect(enHtml).toContain("Continue with Google");
    expect(enHtml).toContain('method="post" action="/signup"');
    expect(enHtml).toContain('name="name"');
    expect(enHtml).toContain('value="Marta"');
    expect(enHtml).toContain('name="email"');
    expect(enHtml).toContain('value="marta@example.com"');
    expect(enHtml).toContain('name="password"');
    expect(enHtml).toContain('type="password"');
    expect(enHtml).toContain('autocomplete="new-password"');
    expect(enHtml).toContain("Create your account");
    expect(enHtml).toContain("Use a password between 10 and 200 characters.");

    const esNoCaptchaNoGoogle = String(
      (
        <SignupView
          chrome={makeChrome("es", "/signup")}
          captchaSiteKey={null}
          googleEnabled={false}
          values={{ name: "", email: "" }}
          error="email-taken"
        />
      ).toString(),
    );
    expect(esNoCaptchaNoGoogle).not.toContain("challenges.cloudflare.com");
    expect(esNoCaptchaNoGoogle).not.toContain("cf-turnstile");
    expect(esNoCaptchaNoGoogle).not.toContain("/auth/google");
    expect(esNoCaptchaNoGoogle).toContain("Crea tu cuenta");
    expect(esNoCaptchaNoGoogle).toContain("Ya existe una cuenta con ese correo. Inicia sesión.");

    const captchaErrEn = String(
      (
        <SignupView
          chrome={makeChrome("en", "/signup")}
          captchaSiteKey={null}
          googleEnabled={false}
          values={{ name: "", email: "" }}
          error="captcha"
        />
      ).toString(),
    );
    expect(captchaErrEn).toContain("Complete the security check and try again.");

    const rateErrEs = String(
      (
        <SignupView
          chrome={makeChrome("es", "/signup")}
          captchaSiteKey={null}
          googleEnabled={false}
          values={{ name: "", email: "" }}
          error="rate-limited"
        />
      ).toString(),
    );
    expect(rateErrEs).toContain("Demasiadas solicitudes. Inténtalo de nuevo más tarde.");
  });

  it("renders LoginView in English and Spanish with exact fields, no Turnstile, and error states", () => {
    const enHtml = String(
      (
        <LoginView
          chrome={makeChrome("en", "/login")}
          googleEnabled={true}
          email="marta@example.com"
          error="wrong-credentials"
        />
      ).toString(),
    );
    expect(enHtml).not.toContain("challenges.cloudflare.com");
    expect(enHtml).toContain('href="/auth/google"');
    expect(enHtml).toContain('method="post" action="/login"');
    expect(enHtml).toContain('name="email"');
    expect(enHtml).toContain('value="marta@example.com"');
    expect(enHtml).toContain('name="password"');
    expect(enHtml).toContain('type="password"');
    expect(enHtml).toContain('autocomplete="current-password"');
    expect(enHtml).toContain('href="/forgot"');
    expect(enHtml).toContain("Forgot your password?");
    expect(enHtml).toContain("Wrong email or password.");

    const esHtml = String(
      (
        <LoginView
          chrome={makeChrome("es", "/login")}
          googleEnabled={false}
          email=""
          error="google-failed"
        />
      ).toString(),
    );
    expect(esHtml).not.toContain("/auth/google");
    expect(esHtml).toContain("Inicia sesión");
    expect(esHtml).toContain("¿Olvidaste tu contraseña?");
    expect(esHtml).toContain(
      "No se pudo completar el acceso con Google. Inténtalo de nuevo o usa tu contraseña.",
    );

    const throttledEs = String(
      (
        <LoginView
          chrome={makeChrome("es", "/login")}
          googleEnabled={false}
          email=""
          error="throttled"
        />
      ).toString(),
    );
    expect(throttledEs).toContain("Demasiados intentos. Inténtalo de nuevo en unos minutos.");
  });

  it("renders ForgotView in English and Spanish across form and sent states", () => {
    const formEn = String(
      (
        <ForgotView
          chrome={makeChrome("en", "/forgot")}
          captchaSiteKey="ts_forgot_key"
          sent={false}
          error="captcha"
        />
      ).toString(),
    );
    expect(formEn).toContain("Reset your password");
    expect(formEn).toContain('method="post" action="/forgot"');
    expect(formEn).toContain('name="email"');
    expect(formEn).toContain("challenges.cloudflare.com/turnstile/v0/api.js");
    expect(formEn).toContain('data-sitekey="ts_forgot_key"');
    expect(formEn).toContain("Complete the security check and try again.");

    const sentEs = String(
      (
        <ForgotView
          chrome={makeChrome("es", "/forgot")}
          captchaSiteKey="ts_forgot_key"
          sent={true}
        />
      ).toString(),
    );
    expect(sentEs).not.toContain('action="/forgot"');
    expect(sentEs).not.toContain("challenges.cloudflare.com");
    expect(sentEs).toContain(
      "Si existe una cuenta con ese correo, te enviamos un enlace válido durante 1 hora para restablecer tu contraseña.",
    );

    const sentEn = String(
      (
        <ForgotView
          chrome={makeChrome("en", "/forgot")}
          captchaSiteKey={null}
          sent={true}
        />
      ).toString(),
    );
    expect(sentEn).toContain(
      "If an account uses that email, we sent a password reset link valid for 1 hour.",
    );
  });

  it("renders ResetView in English and Spanish across form, expired, and done states", () => {
    const formEn = String(
      (
        <ResetView
          chrome={makeChrome("en", "/reset/tok_reset_123")}
          token="tok_reset_123"
          state="form"
          error="weak-password"
        />
      ).toString(),
    );
    expect(formEn).toContain("Choose a new password");
    expect(formEn).toContain('method="post" action="/reset/tok_reset_123"');
    expect(formEn).toContain('name="password"');
    expect(formEn).toContain('type="password"');
    expect(formEn).toContain('autocomplete="new-password"');
    expect(formEn).toContain("Use a password between 10 and 200 characters.");

    const formEs = String(
      (
        <ResetView
          chrome={makeChrome("es", "/reset/tok_reset_123")}
          token="tok_reset_123"
          state="form"
        />
      ).toString(),
    );
    expect(formEs).toContain("Elige una contraseña nueva");
    expect(formEs).toContain("Guardar nueva contraseña");

    const expiredEn = String(
      (
        <ResetView
          chrome={makeChrome("en", "/reset/tok_old")}
          token="tok_old"
          state="expired"
        />
      ).toString(),
    );
    expect(expiredEn).toContain("This reset link has expired");
    expect(expiredEn).toContain('href="/forgot"');

    const expiredEs = String(
      (
        <ResetView
          chrome={makeChrome("es", "/reset/tok_old")}
          token="tok_old"
          state="expired"
        />
      ).toString(),
    );
    expect(expiredEs).toContain("Este enlace ha caducado");

    const doneEn = String(
      (
        <ResetView
          chrome={makeChrome("en", "/reset/tok_done")}
          token="tok_done"
          state="done"
        />
      ).toString(),
    );
    expect(doneEn).toContain("Password updated");
    expect(doneEn).toContain('href="/dashboard"');

    const doneEs = String(
      (
        <ResetView
          chrome={makeChrome("es", "/reset/tok_done")}
          token="tok_done"
          state="done"
        />
      ).toString(),
    );
    expect(doneEs).toContain("Contraseña actualizada");
    expect(doneEs).toContain("Ir a mis listas");
  });

  it("renders DashboardView in English and Spanish with create-list fields, flash states, and zero privacy-sensitive markers", () => {
    const ownerSession = { name: "Marta", logoutAction: "/logout" };
    const enHtml = String(
      (
        <DashboardView
          chrome={makeChrome("en", "/dashboard", ownerSession)}
          userName="Marta"
          flash="created"
          lists={[
            {
              id: "lst_1",
              title: "Marta's 30th",
              occasionDate: "2026-12-05",
              daysLeft: 10,
              itemCount: 3,
            },
            {
              id: "lst_2",
              title: "Summer party",
              occasionDate: null,
              daysLeft: null,
              itemCount: 1,
            },
          ]}
        />
      ).toString(),
    );
    expect(enHtml).toContain("My lists");
    expect(enHtml).toContain("Signed in as Marta.");
    expect(enHtml).toContain("Gift list created.");
    expect(enHtml).toContain('href="/o/lst_1"');
    expect(enHtml).toContain("10 days left");
    expect(enHtml).toContain("3 wishes");
    expect(enHtml).toContain("1 wish");
    expect(enHtml).toContain('method="post" action="/lists"');
    expect(enHtml).toContain('name="title"');
    expect(enHtml).toContain('name="occasionDate"');
    expect(enHtml).toContain('name="locale"');
    assertNoOwnerLeakWords(enHtml);

    const esEmptyHtml = String(
      (
        <DashboardView
          chrome={makeChrome("es", "/dashboard", ownerSession)}
          userName="Marta"
          flash="cap-reached"
          lists={[]}
        />
      ).toString(),
    );
    expect(esEmptyHtml).toContain("Mis listas");
    expect(esEmptyHtml).toContain("Has alcanzado el número máximo de listas por cuenta.");
    expect(esEmptyHtml).toContain("Aún no tienes listas de regalos. Crea la primera abajo.");
    expect(esEmptyHtml).toContain("Crear lista de regalos");
    assertNoOwnerLeakWords(esEmptyHtml);
  });

  it("renders OwnerView in English and Spanish with item CRUD, generic invite link, fieldless regenerate/delete POST forms, and zero guest or claim UI", () => {
    const ownerSession = { name: "Marta", logoutAction: "/logout" };
    const shareText = `Marta invited you to the gift list "Marta's 30th": ${sampleInviteUrl}`;
    const encodedText = encodeURIComponent(shareText);
    const encodedUrl = encodeURIComponent(sampleInviteUrl);
    const share: ShareLinks = {
      text: shareText,
      url: sampleInviteUrl,
      whatsapp: `https://wa.me/?text=${encodedText}`,
      telegram: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`,
      mailto: `mailto:?subject=Gift&body=${encodedText}`,
    };

    const ownerEn = String(
      (
        <OwnerView
          chrome={makeChrome("en", "/o/lst_1", ownerSession)}
          list={sampleOwnerListEn}
          totalCents={8450}
          daysLeft={12}
          inviteUrl={sampleInviteUrl}
          share={share}
          flash="invite-regenerated"
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
        />
      ).toString(),
    );

    expect(ownerEn).toContain("New invite link created.");
    expect(ownerEn).toContain('href="/dashboard"');
    expect(ownerEn).toContain("12 days left");
    expect(ownerEn).toContain("$84.50");
    expect(ownerEn).toContain('action="/o/lst_1/items"');
    expect(ownerEn).toContain('name="name"');
    expect(ownerEn).toContain('name="price"');
    expect(ownerEn).toContain('name="url"');
    expect(ownerEn).toContain('name="details"');
    expect(ownerEn).toContain('action="/o/lst_1/items/itm_1/received"');
    expect(ownerEn).toContain('action="/o/lst_1/items/itm_1"');
    expect(ownerEn).toContain('action="/o/lst_1/items/itm_1/delete"');
    expect(ownerEn).toContain('action="/o/lst_1/items/itm_1/move"');
    expect(ownerEn).toContain(`value="${sampleInviteUrl}"`);
    expect(ownerEn).toContain("data-share-native");
    expect(ownerEn).toContain("data-share-copy");
    expect(ownerEn).toContain(`data-share-url="${sampleInviteUrl}"`);
    expect(ownerEn).toMatch(
      /<form method="post" action="\/o\/lst_1\/invite"[^>]*>\s*<button type="submit"[^>]*>Regenerate invite link<\/button>\s*<\/form>/,
    );
    expect(ownerEn).toMatch(
      /<form method="post" action="\/o\/lst_1\/delete"[^>]*>\s*<button type="submit"[^>]*>Delete list permanently<\/button>\s*<\/form>/,
    );
    expect(ownerEn).not.toContain("/guests");
    assertNoOwnerLeakWords(ownerEn);

    const ownerEs = String(
      (
        <OwnerView
          chrome={makeChrome("es", "/o/lst_1", ownerSession)}
          list={sampleOwnerListEs}
          totalCents={8450}
          daysLeft={12}
          inviteUrl={sampleInviteUrl}
          share={share}
          items={[]}
        />
      ).toString(),
    );
    expect(ownerEs).toContain("Faltan 12 días");
    expect(ownerEs).toContain("84,50");
    expect(ownerEs).toContain(
      "Tu lista está vacía. Escribe arriba tu primer deseo y luego comparte abajo el enlace de invitación.",
    );
    expect(ownerEs).toContain("Generar enlace nuevo");
    expect(ownerEs).toContain("Borrar lista definitivamente");
    expect(ownerEs).not.toContain("/guests");
    assertNoOwnerLeakWords(ownerEs);
  });

  it("renders InviteView in English and Spanish with list title and inviter first, register fields, PIN attributes, and sign-in disclosure", () => {
    const enHtml = String(
      (
        <InviteView
          chrome={makeChrome("en", `/i/${sampleToken}`)}
          list={sampleListEn}
          token={sampleToken}
          captchaSiteKey="ts_invite_key"
          values={{ firstName: "Carlos", lastName: "García", email: "carlos@example.com" }}
        />
      ).toString(),
    );

    const titleIdx = enHtml.indexOf("Marta&#39;s 30th");
    const invitedIdx = enHtml.indexOf("Marta invited you to this birthday gift list.");
    const regFormIdx = enHtml.indexOf(`action="/i/${sampleToken}/register"`);
    const alreadyIdx = enHtml.indexOf("Already registered? Sign in");
    const loginFormIdx = enHtml.indexOf(`action="/i/${sampleToken}/login"`);

    expect(titleIdx).toBeGreaterThan(0);
    expect(invitedIdx).toBeGreaterThan(titleIdx);
    expect(regFormIdx).toBeGreaterThan(invitedIdx);
    expect(alreadyIdx).toBeGreaterThan(regFormIdx);
    expect(loginFormIdx).toBeGreaterThan(alreadyIdx);

    expect(enHtml).toContain('name="firstName"');
    expect(enHtml).toContain('name="lastName"');
    expect(enHtml).toContain('name="email"');
    expect(enHtml).toContain('name="pin"');
    expect(enHtml).toContain('inputmode="numeric"');
    expect(enHtml).toContain('pattern="[0-9]{4}"');
    expect(enHtml).toContain('maxlength="4"');
    expect(enHtml).toContain('autocomplete="off"');
    expect(enHtml).toContain("challenges.cloudflare.com/turnstile/v0/api.js");
    expect(enHtml).toContain('data-sitekey="ts_invite_key"');
    expect(enHtml).not.toContain('<details class="surface-card signin-disclosure" open');

    const esTakenHtml = String(
      (
        <InviteView
          chrome={makeChrome("es", `/i/${sampleToken}`)}
          list={sampleListEs}
          token={sampleToken}
          captchaSiteKey={null}
          values={{ firstName: "Carlos", lastName: "García", email: "carlos@ejemplo.com" }}
          registerError="email-taken"
          loginError="wrong-credentials"
        />
      ).toString(),
    );
    expect(esTakenHtml).not.toContain("challenges.cloudflare.com");
    expect(esTakenHtml).toContain("Marta te invitó a su lista de regalos de cumpleaños.");
    expect(esTakenHtml).toContain(
      "Ya te registraste en esta lista con ese correo. Entra abajo con tu PIN de 4 cifras.",
    );
    expect(esTakenHtml).toContain("Correo o PIN de 4 cifras incorrectos.");
    expect(esTakenHtml).toContain("¿Ya te registraste? Inicia sesión");
    expect(esTakenHtml).toMatch(/<details class="surface-card signin-disclosure" open/);

    const fullEn = String(
      (
        <InviteView
          chrome={makeChrome("en", `/i/${sampleToken}`)}
          list={sampleListEn}
          token={sampleToken}
          captchaSiteKey={null}
          values={{ firstName: "", lastName: "", email: "" }}
          registerError="full"
        />
      ).toString(),
    );
    expect(fullEn).toContain("This gift list has reached its guest limit.");
  });

  it("renders GuestLoginView in English and Spanish with email and 4-digit PIN fields", () => {
    const enHtml = String(
      (
        <GuestLoginView
          chrome={makeChrome("en", "/l/lst_1")}
          list={sampleListEn}
          email="carlos@example.com"
          error="wrong-credentials"
        />
      ).toString(),
    );
    expect(enHtml).toContain('method="post" action="/l/lst_1/login"');
    expect(enHtml).toContain('name="email"');
    expect(enHtml).toContain('value="carlos@example.com"');
    expect(enHtml).toContain('name="pin"');
    expect(enHtml).toContain('inputmode="numeric"');
    expect(enHtml).toContain('pattern="[0-9]{4}"');
    expect(enHtml).toContain('maxlength="4"');
    expect(enHtml).toContain('autocomplete="off"');
    expect(enHtml).toContain("Wrong email or 4-digit PIN.");
    expect(enHtml).toContain(
      "First time on this list? Open the invite link Marta shared with you to register.",
    );

    const esHtml = String(
      (
        <GuestLoginView
          chrome={makeChrome("es", "/l/lst_1")}
          list={sampleListEs}
          email=""
          error="throttled"
        />
      ).toString(),
    );
    expect(esHtml).toContain(
      "Entra con el correo y el PIN de 4 cifras que elegiste para la lista de Marta.",
    );
    expect(esHtml).toContain("Demasiados intentos. Inténtalo de nuevo en unos minutos.");
  });

  it("renders GuestListView in English and Spanish with wrapped taken items, own claims, received badges, and side gifts", () => {
    const guestSession = { name: "Diego Vega", logoutAction: "/l/lst_1/logout" };
    const guestHtml = String(
      (
        <GuestListView
          chrome={makeChrome("en", "/l/lst_1/list", guestSession)}
          list={sampleListEn}
          guestName="Diego Vega"
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
              state: { kind: "taken", byName: "Lucía Ruiz" },
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
              byName: "Diego Vega",
              mine: true,
            },
            {
              id: sideGiftId("sg_other"),
              name: "Homemade pistachio cake",
              priceCents: 1800,
              url: "https://bakery.example.com",
              details: "Bringing it to Saturday dinner",
              byName: "Elena Soto",
              mine: false,
            },
          ]}
        />
      ).toString(),
    );

    expect(guestHtml).toContain('action="/l/lst_1/logout"');
    expect(guestHtml).toContain("Someone else just took that gift.");
    expect(guestHtml).toContain("For Marta. Signed in as Diego Vega.");
    expect(guestHtml).toContain('action="/l/lst_1/items/itm_free/claim"');
    expect(guestHtml).toContain('action="/l/lst_1/items/itm_mine/unclaim"');
    expect(guestHtml).toContain('<span class="gift-tag is-mint">');
    expect(guestHtml).toContain(">You<");
    expect(guestHtml).toContain(
      '<span class="sr-only">Analog camera, wrapped gift claimed by Lucía Ruiz</span>',
    );
    expect(guestHtml).toContain(">Lucía Ruiz<");
    expect(guestHtml).not.toContain("/l/lst_1/items/itm_taken/claim");
    expect(guestHtml).not.toContain("/l/lst_1/items/itm_taken/unclaim");
    expect(guestHtml).toContain(">Received<");
    expect(guestHtml).not.toContain("/l/lst_1/items/itm_rec/claim");
    expect(guestHtml).not.toContain("/l/lst_1/items/itm_rec/unclaim");
    expect(guestHtml).toContain('action="/l/lst_1/ideas"');
    expect(guestHtml).toContain("From Diego Vega, your gift");
    expect(guestHtml).toContain('action="/l/lst_1/ideas/sg_mine"');
    expect(guestHtml).toContain('action="/l/lst_1/ideas/sg_mine/delete"');
    expect(guestHtml).toContain("From Elena Soto");
    expect(guestHtml).not.toContain('action="/l/lst_1/ideas/sg_other"');
    expect(guestHtml).not.toContain('action="/l/lst_1/ideas/sg_other/delete"');

    const guestEs = String(
      (
        <GuestListView
          chrome={makeChrome("es", "/l/lst_1/list", guestSession)}
          list={sampleListEs}
          guestName="Diego Vega"
          flash="invalid"
          items={[
            {
              id: itemId("itm_taken"),
              name: "Cámara analógica",
              priceCents: 9500,
              url: null,
              details: null,
              received: false,
              state: { kind: "taken", byName: "Lucía Ruiz" },
            },
          ]}
          sideGifts={[]}
        />
      ).toString(),
    );
    expect(guestEs).toContain("Revisa los campos marcados e inténtalo de nuevo.");
    expect(guestEs).toContain(
      '<span class="sr-only">Cámara analógica, regalo envuelto reservado por Lucía Ruiz</span>',
    );
    expect(guestEs).toContain(
      "El resto de invitados ve estos regalos para no comprar lo mismo, y Marta nunca los ve.",
    );
    expect(guestEs).toContain(
      "¿Vas a comprar algo que no está en la lista? Añádelo arriba para que nadie lo repita.",
    );

    const guestEsTakenFlash = String(
      (
        <GuestListView
          chrome={makeChrome("es", "/l/lst_1/list", guestSession)}
          list={sampleListEs}
          guestName="Diego Vega"
          flash="already-taken"
          items={[]}
          sideGifts={[]}
        />
      ).toString(),
    );
    expect(guestEsTakenFlash).toContain("Alguien acaba de elegir ese regalo.");
  });
});
