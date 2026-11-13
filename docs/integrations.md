# Optional integrations

Cumplista can run without Turnstile or Google sign-in. Mail has four selectable drivers, including a console driver for local development. See the [configuration reference](configuration.md) for every setting, exact validation error and behaviour limit. Follow [Node self-hosting](self-hosting.md) or [Cloudflare Workers](cloudflare-workers.md) to configure the runtime.

## Cloudflare Turnstile

Turnstile checks requests before owner password signup, guest registration and forgot password. These are the only protected operations:

| Operation | Route |
| --- | --- |
| Owner signup | `POST /signup` |
| Guest registration | `POST /i/:token/register` |
| Forgot password | `POST /forgot` |

The widget is normally invisible. Its markup uses `data-appearance="interaction-only"`, so it appears when interaction is needed. Owner login, guest login and Google sign-in do not run a Turnstile check.

### Setup

1. Open Turnstile in your Cloudflare account and create a widget for this application.
2. Add the hostnames where people will use it, such as `cumplista.example.com`. Include a development hostname if you intend to use this widget there. Hostnames must match where the widget is served.
3. Copy the widget's site key into `TURNSTILE_SITE_KEY`. This public value is rendered in the page.
4. Store the widget's secret as `TURNSTILE_SECRET` in the server environment or Worker secrets. It stays on the server.
5. Restart Node or deploy the updated Worker configuration.

Set both keys or neither. With both unset, no widget or script is rendered and verification is skipped. A partial configuration is rejected with `TURNSTILE_SITE_KEY and TURNSTILE_SECRET must both be set or both be unset`.

Verification happens on the server through Cloudflare's `siteverify` endpoint. The application submits the token and client IP. When configured, it fails closed: a missing token, rejected token, non-success HTTP response, malformed response, network error or 3-second timeout rejects the form. Only a response containing `success: true` passes. The implementation is in [`src/adapters/captcha.ts`](../src/adapters/captcha.ts), [`src/routes/account.ts`](../src/routes/account.ts) and [`src/routes/guest.ts`](../src/routes/guest.ts).

### Verify

Open `/signup`, `/forgot` and a list invite at `/i/<token>` on an allowed hostname. Complete each form normally and confirm that it succeeds. Then submit a protected form without `cf-turnstile-response` or with an invalid token. It should return HTTP 400 with a security-check error. Confirm that `/login` has no widget. If a valid submission fails, check the hostname and that both keys belong to the same widget.

## Google sign-in

Google sign-in authenticates list owners. Guests continue to use their email and PIN. Cumplista uses the authorization code flow with PKCE (`S256`), OAuth state and the scopes `openid email profile`. It starts at `/auth/google` and returns to `/auth/google/callback`. See [`src/adapters/google.ts`](../src/adapters/google.ts) and [`src/routes/account.ts`](../src/routes/account.ts).

### Setup

1. Create or select a project in Google Cloud Console.
2. Configure the OAuth consent screen for your intended audience. Supply the application identity and contact details Google requires. During testing, add the accounts that will test sign-in.
3. Create an OAuth client for a web application. Register the exact authorized redirect URI `${APP_URL}/auth/google/callback`. For example, with `APP_URL=https://cumplista.example.com`, register `https://cumplista.example.com/auth/google/callback`. The implementation removes trailing slashes from `APP_URL` before appending the path.
4. Set `GOOGLE_CLIENT_ID` to the client ID and store `GOOGLE_CLIENT_SECRET` as a private server variable or Worker secret.
5. Set `APP_URL` to the public application URL and restart Node or deploy the Worker.
6. Before public launch, move the consent screen from Testing to In production. While it remains in Testing, only test users can sign in.

Set both credentials or neither. A partial configuration is rejected with `GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must both be set or both be unset`. With neither configured, the button is hidden and both Google routes return HTTP 404.

### Account linking

[`signInWithGoogle`](../src/domain/users.ts) applies these rules in order:

1. Reject a Google profile whose email is not verified.
2. Find an existing user by `google_sub`, Google's stable account identifier. If found, sign in to that user without changing its stored email, name, password or session epoch.
3. Otherwise normalise the verified email by trimming and lowercasing it. Create a new user, or link Google to the existing user with that email.
4. When linking by email, store the Google identifier, clear `password_hash` and increment `session_epoch`. Existing lists and the existing user's name remain attached to the same account. The new Google session uses the updated epoch.

Clearing the password and invalidating old sessions removes access held through the previous password account when the verified email holder takes control through Google. Someone who previously registered that email must not retain access through an old password or cookie. Linking does not merge lists from different user IDs.

The removed password no longer works. The owner can still request a password reset through `/forgot`; completing it sets a new password while retaining the Google link. This behaviour is covered in [`test/cumplista.test.ts`](../test/cumplista.test.ts).

### Verify

Use a separate browser session and open `/login`. Confirm that the Google button appears, follow it through consent, and check that you reach `/dashboard`. Create a list, sign out and sign in with the same Google account to confirm that the same list remains.

To verify email linking, use a test password account whose email matches a verified Google account. Keep an existing session open in another browser. Sign in with Google and confirm that its lists remain, the old password fails and the other session can no longer open `/dashboard`. A failed callback redirects to `/login?error=google`; check the exact redirect URI, client credentials and consent-screen publishing status.

## Mail drivers

Mail sends owner password reset links. Invite sharing uses the list's generic link, rather than sending invitation emails. The adapter is [`src/adapters/mail.ts`](../src/adapters/mail.ts).

| `MAIL_DRIVER` | Runtime | Required settings and setup | How to verify |
| --- | --- | --- | --- |
| `console` | Node; local Workers with loopback `APP_URL` only | Node defaults to this driver. Workers requires explicit `MAIL_DRIVER=console` and `ALLOW_CONSOLE_MAIL=1`. `MAIL_FROM` defaults to `Cumplista <hola@localhost>`. No provider account is needed. | Request a reset for an existing owner at `/forgot`. Find a JSON log entry with `channel: "mail"` and the reset link in `text`. No email is delivered. |
| `cloudflare` | Workers only | Set `MAIL_DRIVER=cloudflare` and `MAIL_FROM`. Configure a `send_email` binding named `EMAIL`. Set up Cloudflare email sending for your domain and the sender and destinations required by your account's email service. See the setup note below. | Request a reset for an existing owner and confirm receipt, then follow the link and complete the reset. |
| `resend` | Node and Workers | Create a Resend account, configure an authorized sending domain and obtain an API key. Set `MAIL_DRIVER=resend`, `RESEND_API_KEY` and an authorized `MAIL_FROM`. The adapter sends through `https://api.resend.com/emails`. | Request a reset for an existing owner, check the provider's delivery record and confirm receipt. Follow the reset link. |
| `smtp` | Node only | Obtain SMTP connection details from your mail provider. Set `MAIL_DRIVER=smtp`, `SMTP_URL` and an authorized `MAIL_FROM`. Use a Nodemailer SMTP URL, for example `smtps://<username>:<password>@<smtp-host>:465`, with credentials encoded for a URL. | Request a reset for an existing owner, check the SMTP provider's delivery record and confirm receipt. Follow the reset link. |

For Cloudflare, the repository config uses `send_email` with `{ "name": "EMAIL" }`. In your Cloudflare account, enable the relevant email service for your domain and complete its sender or recipient verification steps. Provider restrictions still apply even though the application only checks that the binding has a `send` function. Check delivery with your own account before you rely on password recovery. The [Workers guide](cloudflare-workers.md) covers the deployment configuration.

Use `/forgot` with an existing owner account for all delivery checks. The form deliberately gives the same success response for unknown accounts and for delivery failures, so the page alone does not prove that mail was sent. A reset link lasts one hour and is single use. Keep console mail logs private because they contain usable reset links. See [configuration](configuration.md#behaviour-limits) for reset request limits.

## Privacy and trust

The owner's view never exposes guest identities, registrations, claims, side gifts or their counts. This separation is structural: owner domain and route modules do not reference the `guests`, `claims` or `side_gifts` tables. Side gifts live in a separate table from owner items. A static test scans those modules for table references and checks owner routes for guest-domain imports. HTTP tests also check owner pages and mutation responses for private information. Both checks are in [`test/cumplista.test.ts`](../test/cumplista.test.ts).

Guests can see other guests' claims and side gifts to coordinate purchases. They can release only their own claims and edit or delete only their own side gifts. Owner privacy is about what the owner account can access through the application. The person operating the database can read its contents.

The application runs on trust. These are known limits:

- An owner can register as a guest using the invite link and see the guest view. Cumplista does not prove that an owner and a guest are different people.
- A stranger with the generic invite link can register. There is no owner approval step or email verification for guests.
- Guests have no PIN recovery flow. The owner cannot recover their PIN through the application.
- A stranger who knows a guest's email and list can exhaust the sign-in allowance by guessing wrong PINs. The limit is 8 attempts per list and email in a 15-minute window, independent of client IP. This can lock that guest's sign-in for up to 15 minutes, including attempts with the correct PIN. Already signed-in guests retain their sessions.

Share invite links with people you trust. See [architecture](architecture.md) for the data and authorization boundaries.
