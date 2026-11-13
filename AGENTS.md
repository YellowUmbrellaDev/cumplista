# AGENTS.md

Instructions for coding agents and contributors working in this repository. Read it before changing code.

## What this is

Cumplista is a small, self-hostable birthday gift list app. An owner has an account and shares one invite link per list. Guests register on that list with a first name, last name, email and 4-digit PIN, claim gifts and add side gifts. The owner never sees guests, claims or side gifts.

One Hono app (`src/app.ts`) runs on Node 24 (`node:sqlite`) and on Cloudflare Workers (D1). Pages are rendered on the server with `hono/jsx`. There is no client framework, only a small `public/app.js` for progressive enhancement.

## Commands

```sh
npm ci                  # install
npm run typecheck       # tsc --noEmit, must be clean
npm test                # vitest run, must be green
npm start               # run on Node (tsx src/entry-node.ts), port 8787
npm run dev:node        # same with file watching
npm run dev             # wrangler dev (needs .dev.vars, see .dev.vars.example)
npm run db:local        # apply migrations to the local D1 for wrangler dev
npx wrangler deploy --dry-run --outdir /tmp/bundle   # check the Worker bundles
```

Node 24 or newer is required. Before you finish any change, run `npm run typecheck` and `npm test`, and run the dry-run bundle if you touched an entry point, an adapter or `wrangler.jsonc`.

## The privacy boundary (do not break it)

The product promise is that the owner cannot see who joined, who claimed what, or what guests added. The code enforces it by structure, not by convention.

- Owner-side modules must never mention the tables `guests`, `claims` or `side_gifts`, and must not import the guest-side domain modules. The owner-side files are `src/domain/lists.ts`, `users.ts`, `invite.ts`, `password.ts`, `src/routes/owner.ts` and `src/routes/account.ts`.
- The test `STATIC PRIVACY` in `test/cumplista.test.ts` scans those files and fails on a match. The test `PRIVACY INVARIANT` registers guests, claims and side gifts, then checks that no owner page, response or redirect contains any of it.
- If a feature needs owner-visible information about guests, it conflicts with the product. Stop and ask a maintainer instead of working around the test.
- Do not add a defence against an owner who registers as a guest to peek. The app runs on trust on purpose.

## Layout

| Path | What lives there |
| --- | --- |
| `src/app.ts` | Builds the Hono app: Origin check, `/healthz`, mounts the route groups, error handler |
| `src/routes/` | `account.ts` (signup, login, reset, Google), `owner.ts` (dashboard, lists, items), `guest.ts` (invite, register, claim, ideas), `http.ts` (shared helpers), `forms.ts` (form parsers) |
| `src/domain/` | Business logic over `Deps`. Owner side: `lists`, `users`, `invite`, `password`. Guest side: `guests`, `claims`, `ideas`. Shared: `auth`, `rate`, `ip`, `types` |
| `src/views/` | JSX pages (`pages.tsx`), components, layout and page prop types (`props.ts`). Views never touch the database |
| `src/adapters/` | Platform code behind the ports: `sqlite`, `d1`, `mail`, `captcha`, `google` |
| `src/ports.ts` | The `Sql`, `Mailer`, `Captcha`, `GoogleAuth`, `Env` and `Deps` types |
| `src/entry-node.ts`, `src/entry-worker.ts` | Build `Deps` for each platform and validate configuration |
| `src/i18n/` | `LOCALES` registry and one typed message file per language |
| `migrations/` | SQL applied in file order by both platforms |
| `test/` | Behaviour tests against the real app with in-memory SQLite |
| `docs/` | Guides for users and contributors |

## Conventions

- TypeScript is strict. Keep types honest: ids are branded types (`ListId`, `GuestId`, `UserId` and so on). Parse input at the boundary, trust types inside.
- Platform code stays behind the ports. Domain code takes `deps: Deps` as its first argument and must run on both Node and Workers (Web Crypto only, no Node-only APIs).
- Dependencies are `hono`, `@hono/node-server` and `nodemailer`. Do not add a dependency without a strong reason.
- Passwords and PINs go through `src/domain/password.ts` (PBKDF2-SHA256, 100000 iterations, the Workers maximum). Do not change the iteration count or add a second hashing path.
- Count rate-limit attempts before verifying a secret, using `take()` in `src/domain/rate.ts`. Unknown accounts must cost the same as known ones.
- Every locale key exists in `src/i18n/locales/en.ts` and `es.ts`. A missing key is a compile error. Spanish stays neutral between Spain and Latin America, for example "elegir" or "reservar", never "coger".
- Schema changes are a new numbered file in `migrations/`. Never edit an applied migration.
- Comments explain a non-obvious why. Code that is dead goes away, with no compatibility shims.

## Tests

- Tests call the app over HTTP and assert observable results against literal values (status, redirect, rendered text), not internals.
- A bug fix comes with a regression test that fails without the fix. Check that it does.
- `test/cumplista.test.ts` holds the HTTP behaviour and privacy tests, `test/views.test.tsx` the rendering, `test/adapters*.test.ts` the adapters and Worker configuration.

## Security notes

- Cookies are HMAC-signed (`SESSION_SECRET`), `HttpOnly`, `SameSite=Lax`, and `Secure` on an `https` `APP_URL`. CSRF defence is the `Origin` check plus `SameSite`. Forms are `application/x-www-form-urlencoded` and limited to 16 KB.
- Redirect targets that come from a request go through `parseSafeBack`, a closed allowlist. Extend the allowlist for a new page, never loosen it.
- Never log or commit secrets or tokens. Use placeholders such as `cumplista.example.com` in docs and tests. The one exception is `wrangler.jsonc`, which holds the maintainers' own deployment.
- The deployed instance is configured through GitHub environment secrets and Cloudflare. This repository holds no real credentials.

## Git and pull requests

- Work on a branch and open a pull request. Do not push to `main`.
- One focused change per pull request, with tests. CI runs typecheck, tests and a Worker dry-run on every pull request. The deploy job only runs on pushes to `main` of `YellowUmbrellaDev/cumplista`, so forks skip it.
- Commit messages are short and in the imperative ("Let owners change the list language"), explaining why when it is not obvious.
- Do not add tool or author attribution trailers to commits or pull requests.

## Where to read more

- `README.md` for an overview and quick start.
- `docs/self-hosting.md` and `docs/cloudflare-workers.md` to deploy.
- `docs/configuration.md` and `docs/integrations.md` for settings, limits and optional services.
- `docs/architecture.md` and `docs/development.md` before changing internals.
