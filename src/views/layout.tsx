import { html } from "hono/html";
import type { Child } from "hono/jsx";
import type { Chrome } from "./props.js";

export type LayoutProps = {
  chrome: Chrome;
  title: string;
  scripts?: readonly string[] | undefined;
  children: Child;
};

export function Layout({ chrome, title, scripts, children }: LayoutProps) {
  const { t, locale, locales, path, session } = chrome;
  const fullTitle = `${title} | ${t("app.name")}`;

  return html`<!DOCTYPE html>${(
    <html lang={locale}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>{fullTitle}</title>
        <link
          rel="preload"
          href="/fonts/bricolage-grotesque-latin-standard-normal.woff2"
          as="font"
          type="font/woff2"
          crossorigin="anonymous"
        />
        <link rel="stylesheet" href="/app.css" />
        <script src="/app.js" defer></script>
        {scripts?.map((src) => (
          <script key={src} src={src} async defer></script>
        ))}
      </head>
      <body>
        <a href="#main-content" class="skip-link">
          {t("layout.skip_to_content")}
        </a>
        <div class="page-shell">
          <header class="site-header">
            <a href="/" class="brand-link" aria-label={t("layout.home_label")}>
              <span class="brand-knot" aria-hidden="true"></span>
              <span class="brand-name">{t("app.name")}</span>
            </a>
            {session ? (
              <div class="header-actions">
                <span class="session-user">{session.name}</span>
                <form method="post" action={session.logoutAction} class="inline-form">
                  <button type="submit" class="btn-chip">
                    {t("nav.logout")}
                  </button>
                </form>
              </div>
            ) : (
              <nav class="header-actions" aria-label={t("nav.account_label")}>
                <a href="/login" class="btn-chip">
                  {t("nav.login")}
                </a>
                <a href="/signup" class="btn-chip">
                  {t("nav.signup")}
                </a>
              </nav>
            )}
          </header>
          <main id="main-content" class="site-main">
            {children}
          </main>
          <footer class="site-footer">
            <p class="footer-tagline">{t("footer.tagline")}</p>
            <form method="post" action="/lang" class="lang-form">
              <input type="hidden" name="back" value={path} />
              <span class="lang-label">{t("footer.language")}</span>
              <div class="lang-options" role="group" aria-label={t("footer.language")}>
                {locales.map((entry) => (
                  <button
                    key={entry.code}
                    type="submit"
                    name="lang"
                    value={entry.code}
                    class={`lang-btn${entry.code === locale ? " is-active" : ""}`}
                    aria-current={entry.code === locale ? "true" : undefined}
                  >
                    {entry.name}
                  </button>
                ))}
              </div>
            </form>
          </footer>
        </div>
      </body>
    </html>
  )}`;
}
