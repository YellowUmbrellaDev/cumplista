# Deploy on Cloudflare Workers

**Workers Paid is required for this application.** Password and guest PIN hashing use PBKDF2-SHA256 with 100,000 iterations. One derivation takes about 50 ms of CPU time on a typical machine. That exceeds the Workers Free plan's 10 ms CPU limit. Sign-up and sign-in therefore need Workers Paid, even if the landing page works on Free.

This guide deploys the Hono application, its `public/` assets, and a D1 database behind your own domain. Cloudflare handles the Worker runtime, DNS, and HTTPS certificate for the custom domain. You can use Cloudflare Email Sending or Resend for account recovery emails. Turnstile and Google sign-in are optional.

Cloudflare currently lists Workers Paid with a minimum account charge of USD 5 per month. Requests and CPU above the included usage, D1 usage, and email can add charges. Check Cloudflare's current **Workers pricing**, **D1 pricing**, and **Email Service pricing** before deploying. A small installation is not a promise of a fixed monthly bill. For a Node deployment instead, see [self-hosting](self-hosting.md).

## Prerequisites

- A Cloudflare account with Workers Paid enabled.
- An active domain using Cloudflare DNS, in the account where you will deploy.
- Your fork of the repository, downloaded to your machine.
- Node.js 24 or newer and npm. CI uses Node 24.
- Permission to create D1 databases, deploy Workers, and configure the domain.

Run commands from the repository root. Install the locked dependencies:

```sh
npm ci
```

Wrangler is already a development dependency. Use `npx wrangler` to run the repository's version.

For interactive authentication:

```sh
npx wrangler login
```

Alternatively, provide a scoped API token and account ID in your shell:

```sh
export CLOUDFLARE_API_TOKEN='<your-api-token>'
export CLOUDFLARE_ACCOUNT_ID='<account-id>'
```

Replace the placeholders. Obtain the account ID from the Cloudflare dashboard. See [API token permissions](#api-token-permissions) below. These credentials authenticate deployments. They are separate from application secrets such as `SESSION_SECRET`.

## Create and configure D1

Create your own database:

```sh
npx wrangler d1 create cumplista
```

Copy the returned database ID into `d1_databases[0].database_id` in `wrangler.jsonc`. The checked-in ID belongs to another installation. Never deploy with it.

Use this configuration as a template. Replace `<your-database-id>`, every occurrence of `cumplista.example.com`, and the sender address with your own values:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "cumplista",
  "main": "src/entry-worker.ts",
  "compatibility_date": "2026-11-01",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "cumplista",
      "database_id": "<your-database-id>",
      "migrations_dir": "migrations"
    }
  ],
  "send_email": [{ "name": "EMAIL" }],
  "routes": [{ "pattern": "cumplista.example.com", "custom_domain": true }],
  "vars": {
    "APP_URL": "https://cumplista.example.com",
    "MAIL_DRIVER": "cloudflare",
    "MAIL_FROM": "Cumplista <hello@cumplista.example.com>"
  },
  "assets": { "directory": "public" }
}
```

| Setting | Purpose and what to change |
| --- | --- |
| `name` | Worker name in your account. Keep `cumplista`, or choose a name that does not collide with another Worker you own. |
| `main` | Worker entry point, which builds the application dependencies. Keep `src/entry-worker.ts`. |
| `compatibility_date` | Pins Cloudflare runtime compatibility behaviour. Keep the checked-in date for the first deployment. Review runtime changes before updating it. |
| `compatibility_flags` | Enables Node.js compatibility for the bundle. Keep `nodejs_compat`. |
| `d1_databases[].binding` | Exposes the database as `DB`, which the entry point passes to the D1 adapter. Keep this exact binding name. |
| `d1_databases[].database_name` | Database name used by the documented commands, `db:local`, and CI. Keep `cumplista` unless you also update those references. |
| `d1_databases[].database_id` | Selects your remote database. Replace it with the ID returned by `d1 create`. |
| `d1_databases[].migrations_dir` | Points Wrangler at the SQL migrations. It already points to `migrations`; keep it. |
| `send_email[].name` | Exposes `EMAIL.send()` to the Cloudflare mail adapter. Keep `EMAIL` when using `MAIL_DRIVER=cloudflare`. Remove this binding if you switch to Resend. |
| `routes[].pattern` | Your exact hostname, such as `cumplista.example.com`. Use no scheme, path, or `/*`. |
| `routes[].custom_domain` | Makes the Worker the origin for the hostname. Keep `true`; Cloudflare configures its DNS record and certificate. |
| `vars.APP_URL` | Public HTTPS origin, such as `https://cumplista.example.com`, without a trailing slash. Used for recovery links, Google callbacks, cookie security, and origin checks. Match the hostname people actually visit. |
| `vars.MAIL_DRIVER` | Selects the email adapter. Use `cloudflare` or `resend` in production. |
| `vars.MAIL_FROM` | Sender display name and address. Replace it with an address on your onboarded sending domain. |
| `assets.directory` | Uploads the static assets alongside the Worker. Keep `public`. |

The custom hostname must be in your Cloudflare zone. Resolve any existing DNS record or Worker association that conflicts with it before deploying.

Apply the schema to production and to the separate local development database:

```sh
npx wrangler d1 migrations apply cumplista --remote
npx wrangler d1 migrations apply cumplista --local
```

The `--remote` command changes the real database. The `--local` command only changes Wrangler's local database. D1 does not read schema changes automatically from the application. The initial migration creates `users`, `password_resets`, `lists`, `items`, `guests`, `claims`, `attempts`, and `side_gifts`. Wrangler tracks applied migrations, so later runs apply only pending files.

## Configure email

### Cloudflare Email Sending

Use `MAIL_DRIVER=cloudflare` and retain `send_email: [{ "name": "EMAIL" }]`. The application calls `EMAIL.send()` with the configured sender, recipient, subject, text, and HTML. This path does not use SMTP or a separate application email API key.

Cloudflare's **Email Service: Send emails** guide documents domain onboarding:

1. In the Cloudflare dashboard, open **Compute > Email Service > Email Sending**.
2. Select **Onboard Domain** and choose your sending domain.
3. Review the DNS records Cloudflare adds for bounce handling, SPF, DKIM, and DMARC, then finish onboarding.
4. Confirm that the sending domain and its DNS records are ready.
5. Set `MAIL_FROM` to an address on that domain. For example, onboard `cumplista.example.com` for `Cumplista <hello@cumplista.example.com>`.

Onboarding the sending domain is separate from attaching the Worker to a custom domain. Both are needed for the Cloudflare configuration above.

Cloudflare's current **Email Service: Limits** documentation says that before onboarding a sending domain, sending is restricted to verified destination addresses. After onboarding, you can send to other recipients, subject to account limits. New accounts have a conservative daily quota that can change with account standing and sending history. Check Cloudflare's current limits and your account's quota before relying on password reset delivery.

### Resend alternative

Set `MAIL_DRIVER` to `resend`, choose a `MAIL_FROM` address accepted by your Resend account, and remove the unused `send_email` section from `wrangler.jsonc`. Store the API key:

```sh
npx wrangler secret put RESEND_API_KEY
```

The adapter sends email through the Resend HTTPS API. See [integrations](integrations.md) for setup details. If you deploy from CI, also add `RESEND_API_KEY` to the `production` environment secrets.

SMTP is unavailable in the Workers entry point. It rejects that driver with `MAIL_DRIVER=smtp is not supported on Cloudflare Workers`. Use the [Node deployment](self-hosting.md) if you need SMTP.

## Set application secrets

Generate a random session signing secret:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Save the generated value securely, then paste it at the prompt:

```sh
npx wrangler secret put SESSION_SECRET
```

The generated value has 64 hexadecimal characters. The application requires at least 32 characters after trimming whitespace. Use the same value in the GitHub `production` environment if CI will manage deployments. Changing it invalidates existing signed sessions and in-progress Google authentication state.

| Secret | When needed |
| --- | --- |
| `SESSION_SECRET` | Required for every Worker configuration, including local development. |
| `RESEND_API_KEY` | Required only for `MAIL_DRIVER=resend`. |
| `TURNSTILE_SECRET` | Optional, paired with `TURNSTILE_SITE_KEY`. |
| `GOOGLE_CLIENT_SECRET` | Optional, paired with `GOOGLE_CLIENT_ID`. |

Turnstile and Google sign-in can be enabled independently. For Turnstile, set both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET`, or neither. For Google, set both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, or neither. The site key and client ID are public configuration values, but the existing CI workflow also supplies them through Worker secrets. Follow [integrations](integrations.md) for setup, hostnames, callbacks, and the corresponding `wrangler secret put` commands.

You can also pass a JSON secrets file during deployment, as CI does:

```sh
npx wrangler deploy --secrets-file /path/to/worker-secrets.json
```

Its contents are a JSON object mapping the names above to their values. Keep this file out of the repository and remove it after use. A local `.dev.vars` file is for development; it does not replace production Worker secrets.

### Configuration validation

`buildWorkerEnv` in `src/entry-worker.ts` validates configuration on each Worker request, before creating the application. These are its exact rejection messages. The placeholders in the three dynamic messages represent the rejected value.

| Rejected configuration | Error message |
| --- | --- |
| Missing or blank session secret | `SESSION_SECRET is required` |
| Trimmed secret shorter than 32 characters | `SESSION_SECRET must be at least 32 characters` |
| Missing or blank driver | `MAIL_DRIVER is required` |
| SMTP driver | `MAIL_DRIVER=smtp is not supported on Cloudflare Workers` |
| Unknown driver | `Invalid MAIL_DRIVER: <value>` |
| Missing or blank URL | `APP_URL is required` |
| URL cannot be parsed | `Invalid APP_URL: <value>` |
| Protocol other than HTTP or HTTPS | `Invalid APP_URL protocol: <protocol>` |
| HTTP URL on a non-loopback host | `APP_URL must use https: unless host is loopback` |
| Console driver without explicit local opt-in | `MAIL_DRIVER=console requires ALLOW_CONSOLE_MAIL=1 on Cloudflare Workers` |
| Console driver with a non-loopback URL | `MAIL_DRIVER=console is only allowed when APP_URL is loopback` |
| Cloudflare or Resend driver with a loopback URL | `Loopback APP_URL is not allowed on Cloudflare Workers` |
| Missing sender for Cloudflare or Resend | `MAIL_FROM is required` |
| Cloudflare driver without a callable `EMAIL.send` | `EMAIL binding is required when MAIL_DRIVER=cloudflare` |
| Resend driver without a nonblank API key | `RESEND_API_KEY is required when MAIL_DRIVER=resend` |
| Incomplete Turnstile pair | `TURNSTILE_SITE_KEY and TURNSTILE_SECRET must both be set or both be unset` |
| Incomplete Google pair | `GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must both be set or both be unset` |

Loopback means `localhost`, a hostname ending in `.localhost`, `127.0.0.1`, or `::1`. Console mail is only accepted with a loopback `APP_URL` and `ALLOW_CONSOLE_MAIL=1`; its sender defaults to `Cumplista <hola@localhost>` if omitted. These exceptions exist for local development. They do not permit production console mail.

## First deployment

After configuring your database, hostname, mail provider, and secrets, check the bundle without uploading it:

```sh
npx wrangler deploy --dry-run --outdir /tmp/cumplista-workers-bundle
```

Then deploy:

```sh
npx wrangler deploy
```

Check the public endpoint using your hostname:

```sh
curl --fail-with-body https://cumplista.example.com/healthz
```

Expect HTTP 200 and the body `ok`. This endpoint confirms the Worker can serve a request with valid environment settings. It does not query D1 or send an email.

Open `https://cumplista.example.com/signup` and create the first owner account with a name, email, and password of 10 to 200 characters. Successful registration signs you in and redirects to `/dashboard`. There is no separate bootstrap administrator step. Create a list, add a gift, and open its invite link in a separate browser session to exercise the guest flow.

Sign out and sign back in to check password verification. Use `/forgot` for the registered email and confirm the recovery email arrives and its link works. A generic success message on `/forgot` does not prove delivery: the application deliberately gives the same response for unknown accounts and mail delivery failures.

## GitHub Actions deployment

The checked-in `.github/workflows/ci.yml` has two jobs:

| Job | Trigger and behaviour |
| --- | --- |
| `verify` | Runs for pull requests and pushes to `main`. Checks out the code, sets up Node 24, runs `npm ci`, `npm run typecheck`, `npx vitest run`, and a Wrangler dry-run bundle. It does not deploy. |
| `deploy` | Runs only for pushes to `main`, after `verify` succeeds, using the GitHub environment named `production`. Installs dependencies, applies remote D1 migrations, then deploys the Worker with a temporary secrets file. |

Pull request runs for the same ref can cancel an older run. The deployment job uses a shared `deploy-production` concurrency group with cancellation disabled, so production deployment jobs do not overlap.

In your fork, enable Actions if GitHub asks. Create a GitHub environment called `production` under the repository's **Settings > Environments**. Add these environment secrets:

| GitHub environment secret | Required value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Deployment token with the permissions below. |
| `CLOUDFLARE_ACCOUNT_ID` | Account containing the Worker, database, and domain. |
| `SESSION_SECRET` | Same strong session secret used for the initial deployment. |
| `GOOGLE_CLIENT_ID` | Optional, set together with `GOOGLE_CLIENT_SECRET`. |
| `GOOGLE_CLIENT_SECRET` | Optional, set together with `GOOGLE_CLIENT_ID`. |
| `RESEND_API_KEY` | Optional, only for `MAIL_DRIVER=resend`. |
| `TURNSTILE_SITE_KEY` | Optional, set together with `TURNSTILE_SECRET`. |
| `TURNSTILE_SECRET` | Optional, set together with `TURNSTILE_SITE_KEY`. |

Restrict the `production` environment's deployment branches to `main`. This keeps production credentials behind the intended release branch, including if a future workflow change adds another trigger. You can also configure required reviewers if your release process needs approval. The workflow's environment reference alone does not require a human approval.

The migration step runs `npx wrangler d1 migrations apply cumplista --remote` before deploying code. Keep `database_name` and that command aligned. If the migration fails, the deployment step does not run. If the later deployment fails, successfully applied migrations remain in the database, so migrations must remain compatible with the currently running application.

For the deploy step, the workflow sets `umask 077` and writes the nonempty values of `SESSION_SECRET`, `RESEND_API_KEY`, both Google settings and both Turnstile settings to `/tmp/worker-secrets.json`. It passes that file to `wrangler deploy --secrets-file` and removes it after a successful command. Account credentials stay in the deployment process environment and are not written into the application secrets file.

### API token permissions

Use a custom token scoped to the target account and the zone hosting your custom domain. The deployment and migration operations need:

| Scope | Permission | Why |
| --- | --- | --- |
| Account | Workers Scripts: Write | Upload Worker code, assets, bindings, and secrets. |
| Account | D1: Write | Create the database and execute migration SQL. |
| Account | Account Settings: Read | Read account information needed during deployment. |
| Zone | Workers Routes: Write | Configure the Worker route for your custom hostname. |
| Zone | Zone: Read | Find and validate the zone for that hostname. |

Cloudflare's token editor may label write access as **Edit**. Limit the token's resource scope to your installation's account and zone. A token that can upload a script can still fail to apply migrations or attach its hostname if the corresponding permission is absent. The deployment token does not send email. The Worker sends it through its own `EMAIL` binding.

## Run the Worker locally

This uses the Workers entry point and a local D1 database, with console mail instead of a live provider:

```sh
cp .dev.vars.example .dev.vars
npm run db:local
npm run dev
```

The example `.dev.vars` supplies:

```dotenv
APP_URL=http://localhost:8787
MAIL_DRIVER=console
MAIL_FROM=Cumplista <hola@localhost>
ALLOW_CONSOLE_MAIL=1
SESSION_SECRET=dev-only-change-me-at-least-32-chars
```

These values override the production variables during local development. Keep `.dev.vars` private and use a different session secret for production. Leave optional integration pairs unset unless you are configuring them for the local hostname.

`npm run db:local` is `wrangler d1 migrations apply cumplista --local`. `npm run dev` is `wrangler dev`, which runs locally by default with this repository's bindings. Local database state is separate from production. Do not add `--remote` or remote bindings for this local setup.

When Wrangler reports it is ready, check:

```sh
curl --fail-with-body http://localhost:8787/healthz
```

Expect `ok`. Open `http://localhost:8787/signup` to test registration. Recovery messages appear as JSON in the terminal instead of being delivered. Stop the server with Ctrl+C. Local execution and a dry-run bundle do not prove that production CPU limits, DNS, token permissions, or real email delivery are correct.

## Updates and rollback

For an update, review new SQL migrations and configuration requirements first. Back up the database before changing its schema. Replace the output path below with an existing private directory outside the repository:

```sh
npx wrangler d1 export cumplista --remote --output=/path/to/private-backups/cumplista-backup.sql
```

The export contains private application data. Store it securely outside the public repository. Cloudflare's **D1: Time Travel and backups** documentation describes point-in-time recovery and current retention limits.

For a manual release, run:

```sh
npm ci
npm run typecheck
npx vitest run
npx wrangler deploy --dry-run --outdir /tmp/cumplista-workers-bundle
npx wrangler d1 migrations apply cumplista --remote
npx wrangler deploy
```

With CI configured, merging your reviewed update to `main` runs those checks and the deployment workflow. Recheck `/healthz`, sign-in, a list, and email recovery after release.

To restore an earlier Worker version, choose its version ID from Cloudflare's deployment history and run:

```sh
npx wrangler rollback <version-id>
```

A Worker rollback does not undo D1 migrations or restore database rows. Check that the older code supports the current schema before rolling back. A database restore is a separate operation that can discard writes made after the recovery point; follow Cloudflare's D1 recovery documentation and assess those writes before proceeding. Do not edit an already applied SQL migration to try to reverse it.

## Troubleshooting

| Symptom | Check and fix |
| --- | --- |
| Missing Cloudflare mail binding | Keep `send_email: [{ "name": "EMAIL" }]` for this driver. The exact application error is `EMAIL binding is required when MAIL_DRIVER=cloudflare`. |
| Route or zone authorization error | Confirm `routes[].pattern` is your hostname, its zone is active in the correct account, and the token includes **Workers Routes: Write** and **Zone: Read** for that zone. Resolve conflicting DNS records or an existing Worker association. |
| D1 migration permission error or database not found | Confirm **D1: Write**, `CLOUDFLARE_ACCOUNT_ID`, and your own `database_id`. Keep the database name aligned with the command and workflow. |
| `no such table` | Apply migrations to the database actually in use. Local and remote migration commands affect different databases. A successful `/healthz` check does not validate the schema. |
| `SESSION_SECRET` error or an integration pair error | Use the exact validation table above. Add missing secrets to the deployed Worker or CI environment, not only `.dev.vars`. Set both values for each optional integration or leave both unset. |
| Error 1102 or `Worker exceeded resource limits` on registration or login | Check Workers CPU metrics and the account plan. Free's 10 ms CPU limit is insufficient for the configured hashing. Use Workers Paid and review any custom CPU limit on the Worker. |
| `/forgot` reports success but no email arrives | Check the registered address, spam folder, sender domain, provider activity logs, and sending quota. The application hides unknown accounts and delivery failures behind the same response. For Resend, check that CI forwards `RESEND_API_KEY`. |
| Form submissions return 403 or links use the wrong host | Make `APP_URL` match the HTTPS origin you visit and the custom domain. It controls the origin check and generated links. |
| SMTP configuration fails | `MAIL_DRIVER=smtp is not supported on Cloudflare Workers`. Select Cloudflare or Resend, or use the Node deployment. |
