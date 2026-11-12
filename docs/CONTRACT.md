# Cumplista contract

Birthday gift lists. The owner writes a checklist. Guests join with a link plus a 4 digit code, claim items, and see who claimed what. The owner never sees claims.

Stack: Hono + hono/jsx server rendered, no client framework, ~40 lines of vanilla JS for progressive enhancement. Runs on Cloudflare Workers (D1) and on Node 24 (`node:sqlite`). Same `src/app.ts` for both.

## Layout (each file has one owner, workers must not touch files outside their slice)

```
src/domain/types.ts      FIXED (already written, read it)
src/ports.ts             FIXED
src/i18n/index.ts        FIXED. locale files are filled by the UI slice
migrations/0001_init.sql FIXED
--- slice CORE ---
src/domain/lists.ts      services, pure over Deps
src/domain/claims.ts
src/domain/guests.ts
src/domain/auth.ts       tokens, cookie sessions, throttle
src/domain/invite.ts     invite message + share link + mail composition
src/adapters/d1.ts  src/adapters/sqlite.ts  src/adapters/mail.ts
src/app.ts               Hono routes, builds the page props and calls views
src/entry-worker.ts  src/entry-node.ts
test/*.test.ts
--- slice UI ---
src/views/*.tsx          layout + one component per page, takes props, no DB access
src/views/props.ts       FIXED (already written)
src/i18n/locales/{en,es}.ts
public/app.css  public/app.js
```

## Privacy invariant (the point of the product)

- Owner routes call only services returning `OwnerItem` / `OwnerGuest`. These contain no claim data. No query on the owner path may join `claims`.
- Guest list query joins `claims` + `guests` and maps to `GuestItemState` relative to the requesting guest.
- Test: for a list with claimed items, the whole HTML of every owner page and every owner JSON/redirect contains neither a claimer name nor any "taken" marker.
- Owner "mark as received" (`items.received_at`) is visible to guests but says nothing about who claimed.

## Domain rules

- Prices are cents (integer) in the DB. Input is a decimal string in the form field, parsed at the boundary. One currency per list is NOT modeled; display uses the list locale's `Intl.NumberFormat` with currency from `locale` (en -> USD, es -> EUR) as a plain approximation label. Keep it simple.
- `url` must parse as `http:` or `https:`, else rejected. Rendered with `rel="noopener noreferrer nofollow" target="_blank"`.
- Name max 120, details max 1000, title max 120, guest name max 60.
- Invite code: 4 digits, unique per list, generated with `crypto.getRandomValues` rejection sampling. Max 200 guests per list so the space never runs out.
- Guest joins at `GET /l/:listId` (code form) -> `POST /l/:listId/join` with code. Matching a guest row sets a signed cookie `g_<listId>`. Wrong code: record in `join_failures`; more than 8 failures in 10 min for (list, client ip) -> 429 with a localized message. Constant-time comparison of codes.
- If guest `joined_at` is null set it now (owner may see "joined" boolean only).
- Claim: `INSERT INTO claims` and rely on the PK. Constraint violation means "taken by someone else" -> re-render with a localized message, never a 500. Guests can unclaim only their own claim. A received item cannot be claimed or unclaimed.
- Owner auth: creating a list returns an owner token (32 random bytes, base64url) once, stored as SHA-256 hash. The owner reaches `/o/:listId?k=<token>` from the email link, which sets a signed cookie and redirects to `/o/:listId`. Token is emailed to `owner_email` (console mailer logs it in dev). The create success page also shows the manage link once.
- Sessions: HMAC-SHA256 cookie value `<principal-json-b64url>.<sig>` using `SESSION_SECRET`, `HttpOnly; Secure (when APP_URL is https); SameSite=Lax; Path=/`. Web Crypto only so it works on both runtimes.
- CSRF: all mutations are POST forms with SameSite=Lax cookies, and the server additionally rejects POSTs whose `Origin` header is present and differs from `APP_URL`'s origin.
- Everything user-supplied is escaped by JSX. No `dangerouslySetInnerHTML` except none at all.

## Invitations (two paths, same message)

The invite message is localized in the LIST's locale (guest rows do not store a locale):
`invite.message`: "{owner} invited you to their birthday gift list \"{title}\". Open {link} and enter code {code}."
The link is `${APP_URL}/l/${listId}`. The code and the link are ALWAYS in the same message.

1. Email: owner adds guests (name + email) -> mail sent with `invite.subject`, text and minimal HTML. Plain text part contains the same message.
2. Share: owner adds a guest by name only (email optional). Their row has a "Share" button. It uses `navigator.share({ text, url })` when available (WhatsApp, Telegram, Signal, ...) with the full message in `text`; fallback links `https://wa.me/?text=`, `https://t.me/share/url?url=&text=`, `mailto:` with the message, and a copy button. All of this works with the server rendering the message into `data-` attributes and `app.js` only adding the native share. The fallback links must work with JS disabled.
- Owner can resend/regenerate code per guest and remove a guest (removing cascades its claims).

## Pages and routes

| Route | Who | What |
|---|---|---|
| `GET /` | anyone | create-list form (title, your name, your email, optional date) |
| `POST /lists` | anyone | creates list, mails token, shows manage link |
| `GET /o/:id?k=` | owner | exchange token for cookie, redirect |
| `GET /o/:id` | owner | checklist: add/edit/delete/reorder items, mark received, guests panel |
| `POST /o/:id/items`, `/o/:id/items/:item` (edit), `/o/:id/items/:item/delete`, `/o/:id/items/:item/received`, `/o/:id/items/:item/move` | owner | item CRUD |
| `POST /o/:id/guests`, `/o/:id/guests/:g/delete`, `/o/:id/guests/:g/code` | owner | guest management + mail |
| `GET /l/:id` | anyone | code form, or redirect to list if guest cookie valid |
| `POST /l/:id/join` | anyone | verify code |
| `GET /l/:id/list` | guest | list with free / mine / taken states |
| `POST /l/:id/items/:item/claim`, `.../unclaim` | guest | claim/unclaim, redirect back with anchor |
| `POST /lang` | anyone | sets `lang` cookie, redirects back |
| `GET /healthz` | anyone | `ok` |

Locale resolution: `lang` cookie, else Accept-Language, else `en`. A list's locale (used in emails and invite messages) is the owner's locale at creation. Language switcher is a tiny form in the footer.

Extra owner features IN scope (small): item `received` toggle, drag-free reorder by up/down buttons, "price total" of the whole list, `occasion_date` with days left. Out of scope: accounts, images, comments, multiple lists per user UI, currency selection.

## View props (`src/views/props.ts`, fixed by the lead)

Each page has one props type: `CreateListPage`, `CreatedPage`, `OwnerPage {list, items: OwnerItem[], guests: OwnerGuest[], totalCents, shareMessages: Record<GuestId,{text,url,mailto}>}`, `JoinPage {list, error?}`, `GuestListPage {list, guestName, items: GuestItem[]}`, plus a shared `Chrome {t, locale, locales, path}`. Views import types from `../domain/types.js` and never touch `Deps`.

## Visual design (DESIGN direction, set by the lead)

Mode: Operate for owner/guest pages, Persuade-lite for the create page. Subject: gift giving, wrapping.
- Color: paper `#F6F4FF` (cool lavender white, NOT cream), ink `#1D1840`, ribbon `#FF4B5C`, sun `#FFC53D`, mint `#2DBE8C` for "mine"/success, muted `#6B678A`, card `#FFFFFF`. Dark mode via `prefers-color-scheme`: bg `#14112B`, card `#1E1A3D`.
- Type: Bricolage Grotesque Variable (self-hosted from `@fontsource-variable/bricolage-grotesque`, copy the woff2 to `public/fonts/`) for everything. Display headings use its width/optical axes at large size, body at 17px/1.5. No monospace, no all-caps labels, no eyebrow labels.
- Memorable thing, and the only flourish: a claimed item is "wrapped". The row content is blurred (`filter: blur(6px)`, `user-select: none`) while a visually-hidden full label keeps it readable to screen readers, a ribbon stripe crosses the row, and a gift tag hangs off it with the claimer's name. "Mine" is the same row unblurred with a mint tag "You". Free rows are plain white cards. The blur must be CSS only so server rendered; the underlying text is still in the HTML for guests (it is their data to see), the intent is spoiler-protection, not secrecy from guests.
- Layout: single column max 40rem centered, left aligned, generous spacing, 8px grid, radius 14px on cards and 999px on tags only. Checklist rows have a large round checkbox on the left. Owner page: checklist first, guests panel below, add-item form as a persistent first row. Mobile first, tap targets >= 44px.
- Motion: none on load. Only state feedback (claim wraps with a 200ms ribbon sweep, respects `prefers-reduced-motion`).
- Copy: sentence case, plain verbs, errors say what to do. Spanish uses "tú", neutral ES-ES/LatAm wording.
- A11y: visible focus ring (3px ribbon color offset), contrast AA, labels for every field, `lang` attr per locale.
