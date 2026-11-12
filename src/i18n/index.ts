import { en } from "./locales/en.js";
import { es } from "./locales/es.js";

// Adding a language: create locales/<code>.ts typed `Messages`, import it and
// add one line to LOCALES. The compiler rejects a locale missing any key.
export type Messages = typeof en;

export const LOCALES = {
  en: { name: "English", messages: en },
  es: { name: "Español", messages: es },
} as const;

export type LocaleCode = keyof typeof LOCALES;
export const DEFAULT_LOCALE: LocaleCode = "en";

export function isLocale(code: string): code is LocaleCode {
  return Object.hasOwn(LOCALES, code);
}

export function pickLocale(cookie: string | undefined, acceptLanguage: string | undefined): LocaleCode {
  if (cookie && isLocale(cookie)) return cookie;
  for (const part of (acceptLanguage ?? "").split(",")) {
    const tag = part.split(";")[0]?.trim().toLowerCase().split("-")[0] ?? "";
    if (isLocale(tag)) return tag;
  }
  return DEFAULT_LOCALE;
}

export type Translate = (key: keyof Messages, vars?: Record<string, string | number>) => string;

export function translator(locale: LocaleCode): Translate {
  const messages: Messages = LOCALES[locale].messages;
  return (key, vars = {}) =>
    messages[key].replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}
