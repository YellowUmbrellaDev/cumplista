# Configuration reference

This page covers every application environment variable and Worker binding. For deployment steps, see [Node self-hosting](self-hosting.md) or [Cloudflare Workers](cloudflare-workers.md). For provider setup and delivery checks, see [integrations](integrations.md).

## Environment variables and bindings

The sources are [`Env`](../src/ports.ts), the [Node entry point](../src/entry-node.ts), the [Worker entry point](../src/entry-worker.ts), and the [mail](../src/adapters/mail.ts) and [SQLite](../src/adapters/sqlite.ts) adapters. Required means required by the application, including the conditions listed below. Worker variables are text bindings unless marked otherwise. `<value>` in an error stands for the supplied value.

Node reads its process environment. Workers reads its bindings. Most text settings are trimmed; `TRUST_PROXY`, `ALLOW_CONSOLE_MAIL` and `NODE_ENV` use exact string comparisons. On Node, `PORT` is passed directly to `Number`.

| Name | Required? | Runtime | Default | Purpose, validation and exact errors |
| --- | --- | --- | --- | --- |
| `APP_URL` | Workers: yes. Node: no. | Both | Node: `http://localhost:<PORT>`. Workers: none. | Public application URL, used for origin checks, reset links, Google callbacks and the cookie Secure flag. Node does not validate its syntax. Workers errors: `APP_URL is required`, `Invalid APP_URL: <value>`, `Invalid APP_URL protocol: <protocol>`, `APP_URL must use https: unless host is loopback`, `Loopback APP_URL is not allowed on Cloudflare Workers`. See the loopback rules below. |
| `SESSION_SECRET` | Workers: yes. Node: required in production. | Both | Node outside production: `cumplista-dev-insecure-session-secret`. Workers: none. | Signs session and OAuth cookies. Workers requires at least 32 characters: `SESSION_SECRET is required`, `SESSION_SECRET must be at least 32 characters`. Node enforces the same minimum only when `NODE_ENV=production`, with `SESSION_SECRET must be at least 32 characters` or `SESSION_SECRET is required when NODE_ENV=production`. An unset development secret logs `Warning: SESSION_SECRET is not set, using insecure development default.` |
| `MAIL_DRIVER` | Workers: yes. Node: no. | Both | Node: `console`. Workers: none. | Selects `console`, `cloudflare`, `resend` or `smtp`, subject to runtime support. Node rejects Cloudflare with `MAIL_DRIVER=cloudflare is only supported on Cloudflare Workers`. Workers rejects SMTP with `MAIL_DRIVER=smtp is not supported on Cloudflare Workers`. Other values produce `Invalid MAIL_DRIVER: <value>`. Missing on Workers: `MAIL_DRIVER is required`. |
| `MAIL_FROM` | Workers: required except with `console`. Node: no. | Both | Node, or Workers with `console`: `Cumplista <hola@localhost>`. Otherwise none. | Sender passed to the mail provider. Workers rejects an empty sender with `MAIL_FROM is required`. Neither entry point validates email syntax or provider authorization. |
| `RESEND_API_KEY` | When `MAIL_DRIVER=resend`. | Both | Unset | Resend API credential. Error: `RESEND_API_KEY is required when MAIL_DRIVER=resend`. Workers checks it before handling requests. Node checks when sending mail. No credential validity check at configuration time. |
| `SMTP_URL` | Node: when `MAIL_DRIVER=smtp`. | Both, but only used on Node | Unset | Nodemailer connection URL. Error at send time: `SMTP_URL is required when MAIL_DRIVER=smtp`. No application URL syntax check; Nodemailer handles connection errors. Workers accepts the variable but rejects the SMTP driver. |
| `TURNSTILE_SITE_KEY` | Optional, paired with `TURNSTILE_SECRET`. | Both | Unset, integration disabled | Public widget key. Supplying only one key produces `TURNSTILE_SITE_KEY and TURNSTILE_SECRET must both be set or both be unset`. The application does not check that the keys belong to the same widget. |
| `TURNSTILE_SECRET` | Optional, paired with `TURNSTILE_SITE_KEY`. | Both | Unset, integration disabled | Private server verification key. Same pair validation and error as `TURNSTILE_SITE_KEY`. |
| `GOOGLE_CLIENT_ID` | Optional, paired with `GOOGLE_CLIENT_SECRET`. | Both | Unset, integration disabled | Google OAuth client ID. Supplying only one value produces `GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must both be set or both be unset`. No credential validity check at configuration time. |
| `GOOGLE_CLIENT_SECRET` | Optional, paired with `GOOGLE_CLIENT_ID`. | Both | Unset, integration disabled | Private Google OAuth client credential. Same pair validation and error as `GOOGLE_CLIENT_ID`. |
| `HOST` | No | Node | All interfaces | Network address to listen on. Set `HOST=127.0.0.1` behind a reverse proxy so only the proxy can reach the app. |
| `PORT` | No | Node | `8787` | HTTP listening port. Must parse as an integer from 1 to 65535; otherwise `Invalid PORT: <value>`. |
| `DATA_DIR` | No | Node | `./data/cumplista.db` | SQLite location, relative to the working directory unless absolute. A path ending in `.db`, `.sqlite` or `.sqlite3` is used as a file; any other path is a directory containing `cumplista.db`. `:memory:` selects an in-memory database. Parent directories are created and migrations are applied automatically. No custom configuration error; filesystem and SQLite errors propagate. |
| `TRUST_PROXY` | No | Node | Disabled | Only `1` enables use of the last nonempty address in `X-Forwarded-For`. Otherwise the socket remote address is used. No value validation or custom error. Enable only behind a proxy that controls that header. |
| `NODE_ENV` | No | Node | Unset | Only the exact value `production` enables the production session-secret requirements above. Other values do not. No separate value validation or error. |
| `ALLOW_CONSOLE_MAIL` | Workers: required as `1` when `MAIL_DRIVER=console`. | Workers | Unset | Permits console mail for local development. Other values cause `MAIL_DRIVER=console requires ALLOW_CONSOLE_MAIL=1 on Cloudflare Workers`. A nonloopback URL also causes `MAIL_DRIVER=console is only allowed when APP_URL is loopback`. |
| `DB` | Yes | Workers, D1 binding | None | D1 database used by the SQL adapter. Configure the binding as `DB` and apply migrations. There is no explicit missing-binding validation or stable custom error; database operations fail if it is absent or incompatible. |
| `EMAIL` | When `MAIL_DRIVER=cloudflare`. | Workers, email binding | None | Outgoing email binding. Must expose a `send` function; otherwise `EMAIL binding is required when MAIL_DRIVER=cloudflare`. Not used by other drivers. |

For Workers, loopback means `localhost`, a hostname ending in `.localhost`, `127.0.0.1`, or IPv6 loopback (`::1`). Loopback URLs are allowed only with `MAIL_DRIVER=console` and `ALLOW_CONSOLE_MAIL=1`. Other drivers require a nonloopback HTTPS URL. Local Workers development therefore needs the explicit console settings in [`.dev.vars.example`](../.dev.vars.example).

Set `APP_URL` to the public origin, for example `https://cumplista.example.com`, and use a strong, private `SESSION_SECRET`. Changing that secret invalidates existing signed cookies. The [mail driver table](integrations.md#mail-drivers) explains which transport works on each runtime.

## Behaviour limits

These values are fixed in source, not configurable through environment variables. Rate windows look backward from each request. Login limits count admitted attempts, including successful sign-ins, rather than only wrong credentials. Both the email and client rules must pass where two rules are listed.

A client bucket is an IPv4 address or an IPv6 `/64` network. Owner signup groups IPv6 clients by `/48` instead. Missing or invalid addresses share the `unknown` bucket. Node gets the address from the socket or trusted proxy header; Workers uses `CF-Connecting-IP`. See [`src/domain/ip.ts`](../src/domain/ip.ts) and [`src/routes/http.ts`](../src/routes/http.ts).

| Behaviour | Limit and scope | Source |
| --- | --- | --- |
| Owner password signup | 5 attempts per client per hour | [`src/domain/users.ts`](../src/domain/users.ts), `signupWithPassword` |
| Owner password login | 10 attempts per normalised email and 30 per client, each in 15 minutes | [`src/domain/users.ts`](../src/domain/users.ts), `loginWithPassword` |
| Forgot password | 3 requests per normalised email and 10 per client, each per hour | [`src/domain/users.ts`](../src/domain/users.ts), `requestPasswordReset` |
| Guest registration | 10 attempts per list and client per hour, after input validation | [`src/domain/guests.ts`](../src/domain/guests.ts), `REGISTER_HOURLY_LIMIT` |
| Guest login | 8 attempts per list and normalised email, and 20 per list and client, each in 15 minutes | [`src/domain/guests.ts`](../src/domain/guests.ts), `LOGIN_EMAIL_LIMIT`, `LOGIN_CLIENT_LIMIT`, `LOGIN_WINDOW_MS` |
| List creation | 20 attempts per owner in 24 hours, after input validation | [`src/domain/lists.ts`](../src/domain/lists.ts), `createList`; [`src/domain/rate.ts`](../src/domain/rate.ts), `DAY_MS` |
| Lists per owner | 50 existing lists | [`src/domain/lists.ts`](../src/domain/lists.ts), `createList` SQL condition |
| Items per list | 500 | [`src/domain/lists.ts`](../src/domain/lists.ts), `MAX_ITEMS_PER_LIST` |
| Guests per list | 200 | [`src/domain/guests.ts`](../src/domain/guests.ts), `MAX_GUESTS_PER_LIST` |
| Side gifts (ideas) per guest | 50 per list | [`src/domain/ideas.ts`](../src/domain/ideas.ts), `MAX_IDEAS_PER_GUEST` |
| Form request body | 16,384 bytes (16 KiB). Oversize bodies return HTTP 413. Forms must use `application/x-www-form-urlencoded`; other media types return HTTP 415. | [`src/routes/http.ts`](../src/routes/http.ts), `MAX_FORM_BYTES`, `readForm`; body-limit middleware in [`account`](../src/routes/account.ts), [`owner`](../src/routes/owner.ts) and [`guest`](../src/routes/guest.ts) routes |
| Owner and guest session cookies | 31,536,000 seconds (365 days). `HttpOnly`, `SameSite=Lax`, `Path=/`; `Secure` when `APP_URL` uses HTTPS. Cookies are named `cp_owner` and `cp_g_<listId>`. | [`src/routes/http.ts`](../src/routes/http.ts), `SESSION_MAX_AGE_SECONDS`, `sessionCookieOptions`; [`src/domain/auth.ts`](../src/domain/auth.ts), cookie names |
| Owner password | 10 to 200 JavaScript string code units. No composition requirement. | [`src/domain/password.ts`](../src/domain/password.ts), `isValidPassword` |
| Guest PIN | Exactly 4 ASCII digits (`0` to `9`); leading zeros are allowed. | [`src/domain/password.ts`](../src/domain/password.ts), `isValidPin` |
| Password reset link | 1 hour, single use. Requesting another link replaces the previous one. Completing a reset invalidates old owner sessions. | [`src/domain/users.ts`](../src/domain/users.ts), `requestPasswordReset`, `completeReset` |
| Google OAuth state cookie | 600 seconds (10 minutes) | [`src/routes/account.ts`](../src/routes/account.ts), `OAUTH_TTL_SECONDS` |

The 365-day value is the browser cookie lifetime. Session principals also depend on the current owner session epoch or guest session nonce in the database. The signed session payload itself has no time-based expiry. See [architecture](architecture.md) for the authentication structure and [privacy and trust](integrations.md#privacy-and-trust) for guest access limits.

## Languages and currency

English (`en`) and Spanish (`es`) are registered in [`src/i18n/index.ts`](../src/i18n/index.ts). English is the default. The interface first uses a supported `lang` cookie, then the first supported base language in `Accept-Language`, then English.

To add a language:

1. Create `src/i18n/locales/<code>.ts`. Follow [`es.ts`](../src/i18n/locales/es.ts): import `Messages` from `../index.js` and declare the exported dictionary with that type.
2. Translate every key from [`en.ts`](../src/i18n/locales/en.ts), preserving placeholders such as `{link}`. `Messages` is derived from the English dictionary, so a missing key is a compile error.
3. Import the dictionary in `src/i18n/index.ts` and add its code, display name and messages to `LOCALES`. `LocaleCode`, validation and the language selectors derive from that registry.
4. Run `npm run typecheck` to check the dictionary and its callers.

A list has its own language. [`formatMoney`](../src/views/components.tsx) uses that list language to choose both number formatting and currency: `en` shows USD; every other language shows EUR. Adding another language therefore gives it EUR unless this function changes. Changing a list's language reformats the same stored cents. It does not convert amounts or apply an exchange rate. For example, 1,000 stored cents represents 10 USD with English and 10 EUR with Spanish.
