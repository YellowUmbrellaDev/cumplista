# Cumplista

Cumplista runs birthday gift lists where guests coordinate without accounts while keeping gift claims off the owner's view. The same Hono server-rendered application runs on Node 24 with `node:sqlite` and on Cloudflare Workers with D1.

## Privacy model

- The owner cannot see claims through the app, and can only see them by visibly joining as a guest.
- Owner services read only `lists`, `items`, and `guests`, and never query `claims` or `side_gifts`.
- Guests see who claimed each wish and can post off-list gifts in a separate section that does not appear on owner pages.
- Marking a wish as received sets `items.received_at` without revealing which guest claimed it.
- Each guest receives a unique `invite_token` in `/l/:listId?i=<token>` and a single-use 4-digit `code`. Both disappear from the owner page after the guest joins, and the guest's session cookie binds to a per-guest `session_nonce` rather than the 4-digit code.
- Issuing a new code rotates `code` and `session_nonce` while keeping `invite_token`, which invalidates any prior guest cookie and resets the guest's joined badge.

## Run on Node

Requires Node 24 or newer.

```sh
npm install
SESSION_SECRET="$(openssl rand -base64 32)" APP_URL="http://localhost:8787" npm start
```

For local development with file watching, run `npm run dev:node`.

The Node entry point reads these environment variables.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SESSION_SECRET` | When `NODE_ENV=production` | Dev fallback with warning | HMAC-SHA256 secret for owner and guest cookies |
| `APP_URL` | No | `http://localhost:<PORT>` | Public origin used in invite links, `Origin` checks, and `Secure` cookies |
| `PORT` | No | `8787` | HTTP listen port |
| `DATA_DIR` | No | `./data` | Directory or `.db` file path for SQLite, or `:memory:` |
| `TRUST_PROXY` | No | `0` | Set to `1` behind a trusted reverse proxy to read the last `X-Forwarded-For` entry instead of the socket address |
| `MAIL_DRIVER` | No | `console` | Outbound mail transport, one of `console`, `resend`, or `smtp` |
| `MAIL_FROM` | No | `Cumplista <hola@localhost>` | Sender address for outgoing mail |
| `RESEND_API_KEY` | When `MAIL_DRIVER=resend` | None | API key for the Resend HTTP API |
| `SMTP_URL` | When `MAIL_DRIVER=smtp` | None | Connection URL passed to Nodemailer |

## Deploy on Cloudflare Workers

`wrangler.jsonc` ships with no runtime defaults so a misconfigured Worker fails closed. For local Worker development, copy `.dev.vars.example` first.

```sh
cp .dev.vars.example .dev.vars
npm run db:local
npm run dev
```

Follow these steps to deploy to Cloudflare.

1. Run `npx wrangler d1 create cumplista` and set `d1_databases[0].database_id` in `wrangler.jsonc`.
2. Add a `vars` object in `wrangler.jsonc` with your public `https://` `APP_URL`, `MAIL_DRIVER` set to `"resend"`, and `MAIL_FROM`. `buildWorkerEnv` requires `SESSION_SECRET` to be at least 32 characters, requires `APP_URL` to use `https:` unless the host is loopback, rejects `MAIL_DRIVER=smtp`, rejects loopback `APP_URL` when `MAIL_DRIVER` is `resend`, and allows `MAIL_DRIVER=console` only when `ALLOW_CONSOLE_MAIL=1` and `APP_URL` is loopback.
3. Apply migrations with `npx wrangler d1 migrations apply cumplista --remote`.
4. Set secrets with `npx wrangler secret put SESSION_SECRET` and `npx wrangler secret put RESEND_API_KEY`.
5. Run `npm run deploy`. Workers read client IPs only from `CF-Connecting-IP`.

## Known limits

- The owner issues the invite links and codes, so an owner who invents a guest can join as that guest and read claims. This is visible to the other guests, who see who has joined.
- Owner links do not expire.
- List creation is limited per client (5 per hour, IPv6 grouped by /48) and per owner email (3 per day). There is no site-wide cap, because a cap shared by everyone lets a few addresses block every real user. A determined attacker with many addresses can still send owner emails, so put a CAPTCHA such as Turnstile in front of `POST /lists` if you host this publicly.
- The item and idea caps are checked before the insert, so simultaneous requests can exceed them by a few rows.

## Add a language

1. Copy `src/i18n/locales/es.ts` to `src/i18n/locales/<code>.ts` and translate every key in `Messages`. `tsc` fails if any key from `src/i18n/locales/en.ts` is missing or extra.
2. Import the locale in `src/i18n/index.ts` and register it in `LOCALES`. The footer language switcher and `Accept-Language` header negotiation read directly from `LOCALES`.
3. Update `formatMoney` in `src/views/components.tsx` if the locale should display a currency other than `EUR`.

## Verify

```sh
npm run typecheck
npm test
```
