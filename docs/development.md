# Development

Use Node 24 or newer. Node 24 is the CI version, and the Node runtime uses the built-in `node:sqlite` module. From the repository root:

```sh
npm ci
npm test
npm run typecheck
npm run dev:node
```

The Node server defaults to `http://localhost:8787`, stores SQLite data in `./data/cumplista.db` and logs password reset mail to the console. Without a configured session secret, development uses an insecure default and prints a warning. See [configuration](configuration.md) for environment variables and [self-hosting](self-hosting.md) for production setup.

## Package scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the local Worker runtime with `wrangler dev`. |
| `npm run dev:node` | Runs the Node entry point with `tsx watch`. |
| `npm start` | Runs the Node entry point once with `tsx`. |
| `npm test` | Runs all Vitest tests once. |
| `npm run typecheck` | Runs `tsc --noEmit`. |
| `npm run deploy` | Deploys the Worker with Wrangler. |
| `npm run db:local` | Applies D1 migrations to the local Wrangler database. |

For local Worker setup, including `.dev.vars`, see [Cloudflare Workers](cloudflare-workers.md). `deploy` targets a real account and is not part of local verification.

## Tests

The suite uses real SQLite databases and exercises the Hono app through HTTP requests. Network services are replaced with controlled mail, captcha, Google or fetch implementations. Tests compare status codes, redirects, cookies, rendered text and database values against literal expectations.

| File | Coverage |
| --- | --- |
| `test/cumplista.test.ts` | Owner accounts, reset tokens, Google linking, captcha, list and item operations, guest authentication, concurrent claims, rate limits, privacy, CSRF checks, body limits and locales. |
| `test/views.test.tsx` | English and Spanish rendered pages, forms, errors, session navigation, language selection and privacy-sensitive UI. |
| `test/adapters.test.ts` | SQLite migration replay, D1 adaptation, Resend delivery, IP buckets, runtime IP resolution, Worker configuration and Worker fetch. |
| `test/adapters2.test.ts` | Cloudflare email, Resend timeouts, Turnstile verification, Google PKCE/token parsing and Worker binding validation. |

For a focused run, Vitest accepts a file path:

```sh
npx vitest run test/cumplista.test.ts
```

Behaviour changes need tests at the HTTP boundary. Preserve the static and HTTP privacy checks described in [architecture](architecture.md#privacy-boundary).

## Static view previews

```sh
npx tsx scripts/preview-views.tsx
```

The script recreates `/tmp/cumplista-preview`, copies `public/` into it and renders fixed sample data through the real page components. It rewrites CSS, JavaScript and font references for local files. It does not start a server or connect to a database.

It writes one HTML file per page and language, so you can open them in a browser to check the design without a server. These are static examples, so their forms do not work.

## Continuous integration

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on pull requests and pushes to `main`. Its `verify` job uses Node 24 and runs dependency installation, typechecking, all tests and a Worker deployment dry run that writes a bundle under `/tmp/bundle`. Verification does not deploy the application.

The `deploy` job depends on `verify` and runs only for pushes to `main`. It uses the `production` environment, applies remote D1 migrations and deploys the Worker with production secrets. It is the maintainers' own deployment. It runs only when the repository is `YellowUmbrellaDev/cumplista`, so pull requests and forks skip it. To deploy from your own fork, change the repository name in the job's `if:` condition and create the `production` environment with your secrets. See [Cloudflare Workers](cloudflare-workers.md) for deployment setup.

## Add a language

1. Create `src/i18n/locales/<code>.ts`. Export a dictionary typed as `Messages` from `src/i18n/index.ts`, following `es.ts`.
2. Translate every English key and preserve placeholders such as `{owner}`, `{title}` and `{link}`.
3. Import the dictionary in `src/i18n/index.ts` and add its display name and messages to `LOCALES`. `LocaleCode`, validation and the application language selector derive from that registry.
4. Add rendering coverage. The view tests and preview script currently enumerate English and Spanish explicitly, so extend their fixtures if the new language should appear there.
5. Check `formatMoney()` in `src/views/components.tsx`. It currently selects USD for English and EUR otherwise; choose the intended formatting for the new language.
6. Run the tests and typecheck.

Interface language and list language are separate. Request language follows the cookie and `Accept-Language`; the stored list locale controls price formatting.

## Add a migration

Add a new SQL file under `migrations/` using the next zero-padded number and a short name, such as `0002_add_example.sql`. Keep existing migrations unchanged. The Node adapter selects `.sql` files in lexical filename order, applies each pending file in a transaction and records its name in `_migrations`. It does this whenever the SQLite adapter opens, including server startup.

For local D1, run:

```sh
npm run db:local
```

Wrangler uses the configured `migrations` directory and tracks D1 migrations separately from the Node adapter. Production D1 migrations are applied by the deployment workflow. Test a new migration against both a fresh database and an existing database. Update the adapter test's literal migration filename expectation when adding a file.

## Add a route

Put owner account handlers in `src/routes/account.ts`, authenticated owner list handlers in `src/routes/owner.ts`, and guest entry or coordination handlers in `src/routes/guest.ts`. The three groups are already mounted in `src/app.ts`.

Resolve the session before protected work. Owner list routes must check ownership; guest routes must resolve a guest for the requested list. Validate incoming fields in the route or `routes/forms.ts` and pass typed inputs to domain functions. Follow existing POST handlers for the 16 KiB body limit and URL-encoded form parsing. The app-wide origin middleware applies to newly mounted routes.

Owner modules must not reference `guests`, `claims` or `side_gifts`, or expose guest data in page inputs, errors, counts or redirects. Keep guest queries in guest domain modules and preserve the static privacy test's file boundary. Add HTTP tests with literal expected results and run the full suite.

## Code conventions

Application runtime dependencies are Hono, its Node server adapter and Nodemailer. The font files are checked in under `public/fonts`. The UI uses server-rendered JSX and a small plain JavaScript enhancement script.

TypeScript uses `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Identifiers use branded types, operations return discriminated `Result` unions, and external services sit behind the interfaces in `src/ports.ts`. Keep owner and guest data structures separate and test observable behaviour against literal values.

## Contributing

Open an issue before a large change. Keep pull requests small and focused. Include tests for behaviour changes and ensure tests and typechecking pass before requesting review.
