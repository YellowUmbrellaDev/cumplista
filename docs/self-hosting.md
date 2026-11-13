# Self-hosting on Node

## Requirements

Use Node.js 24 or newer, npm, and a writable local disk on a VPS, home server or Raspberry Pi. Check `node --version` before installing. No database server or Cloudflare account is needed. Node's built-in `node:sqlite` stores the data. The app creates the schema from `migrations/` on its first start.

## Quick start

```sh
git clone https://github.com/YellowUmbrellaDev/cumplista.git
cd cumplista
npm ci
npm start
```

Open `http://localhost:8787`, or check it from another terminal:

```sh
curl -fsS http://localhost:8787/healthz
```

The response is `ok`. Open `/signup` to create an owner account with a name, email and password (10 to 200 characters). You can also check registration with curl:

```sh
curl -i -c /tmp/cumplista-cookies \
  -H 'Origin: http://localhost:8787' \
  --data-urlencode 'name=Test Owner' \
  --data-urlencode 'email=owner@example.com' \
  --data-urlencode 'password=example-password-123' \
  http://localhost:8787/signup
curl -fsS -b /tmp/cumplista-cookies http://localhost:8787/dashboard
rm /tmp/cumplista-cookies
```

Registration returns `302` with `Location: /dashboard` and a `cp_owner` cookie. Stop the server with Ctrl+C. This quick start uses development defaults. Configure the settings below before you expose it publicly.

## Production configuration

Node reads process environment variables. It does not load `.dev.vars` or an environment file automatically. Use systemd's `EnvironmentFile`, Docker's `env_file`, or export variables in your shell.

| Variable | Behaviour on Node |
| --- | --- |
| `HOST` | Address to listen on. Unset means every network interface. Set `HOST=127.0.0.1` when a reverse proxy runs on the same machine, so only the proxy can reach the app. |
| `PORT` | Default `8787`. Must be an integer from 1 to 65535. |
| `NODE_ENV` | `production` requires `SESSION_SECRET` to contain at least 32 characters. |
| `SESSION_SECRET` | Cookie signing secret. In production, required and at least 32 characters after trimming. Otherwise an unset value uses an insecure development default and logs a warning. Keep it stable across restarts. Changing it invalidates signed cookies. |
| `APP_URL` | Public base URL, default `http://localhost:<PORT>`. Controls the cookie `Secure` attribute, the form `Origin` check, reset links and the Google callback URL. Use your exact public origin, for example `https://cumplista.example.com`. Node does not validate this URL on startup. |
| `DATA_DIR` | SQLite directory or filename. Default `./data/cumplista.db`; see below. |
| `TRUST_PROXY` | Only `1` enables trusting `X-Forwarded-For`. Otherwise the socket address identifies clients. |
| `MAIL_DRIVER` | Default `console`. Node accepts `console`, `smtp` and `resend`. `cloudflare` fails at startup. |
| `MAIL_FROM` | Sender, default `Cumplista <hola@localhost>`. Set a sender accepted by your mail provider. |
| `SMTP_URL` | Required when sending with `MAIL_DRIVER=smtp`. Passed directly to Nodemailer. |
| `RESEND_API_KEY` | Required when sending with `MAIL_DRIVER=resend`. |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` | Both set or both unset. Omit both to disable Turnstile and run without this Cloudflare service. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Both set or both unset. Omit both to disable Google sign-in. |

Generate a secret:

```sh
openssl rand -hex 32
```

This produces 64 hexadecimal characters. Put the output in a private environment file, replacing the placeholder below. Do not put secrets in source control. For example, `/etc/cumplista.env` for systemd:

```dotenv
NODE_ENV=production
PORT=8787
HOST=127.0.0.1
APP_URL=https://cumplista.example.com
DATA_DIR=/var/lib/cumplista
SESSION_SECRET=replace-with-the-output-of-openssl-rand-hex-32
TRUST_PROXY=1
MAIL_DRIVER=smtp
MAIL_FROM="Cumplista <hello@cumplista.example.com>"
SMTP_URL=smtps://user:password@smtp.example.com:465
```

Protect the file with permissions such as `root:root`, mode `600`. Replace the domain and mail credentials. The Node entry point does not read `ALLOW_CONSOLE_MAIL`; console mail remains technically available in production, but should only be used for development.

Startup stops with these messages when the configuration is wrong:

| Configuration | Exact error text |
| --- | --- |
| Production, no secret | `SESSION_SECRET is required when NODE_ENV=production` |
| Production, secret `short` | `SESSION_SECRET must be at least 32 characters` |
| `PORT=wrong` | `Invalid PORT: wrong` |
| `MAIL_DRIVER=wrong` | `Invalid MAIL_DRIVER: wrong` |
| `MAIL_DRIVER=cloudflare` | `MAIL_DRIVER=cloudflare is only supported on Cloudflare Workers` |
| Only a Turnstile site key | `TURNSTILE_SITE_KEY and TURNSTILE_SECRET must both be set or both be unset` |
| Only a Google client ID | `GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must both be set or both be unset` |

Missing SMTP or Resend credentials fail when sending mail, not on startup. `/healthz` only returns `ok`; it does not check mail delivery.

## Data, backups and migrations

`DATA_DIR` is trimmed. An unset or blank value uses `./data/cumplista.db`, relative to the working directory. A value ending in `.db`, `.sqlite` or `.sqlite3` (case insensitive) is used as the database filename. Other values are directories, with `cumplista.db` appended. Parent directories are created automatically. `:memory:` creates a temporary in-memory database and loses data on exit.

File databases use WAL mode, foreign keys, and a 5,000 ms busy timeout. The service user needs write access to the containing directory for the database and its `-wal` and `-shm` files. Use a local disk and keep the entire data directory persistent.

For a live backup, install the SQLite CLI and run:

```sh
sudo install -d -o cumplista -g cumplista -m 700 /var/backups/cumplista
sudo -u cumplista sqlite3 /var/lib/cumplista/cumplista.db \
  ".backup '/var/backups/cumplista/cumplista.db'"
sudo -u cumplista sqlite3 /var/backups/cumplista/cumplista.db 'PRAGMA integrity_check;'
```

Alternatively, stop the app cleanly before copying the database file. Do not copy only the main `.db` file while the app is running: committed data can still be in the WAL. Keep another backup off the server. Stop the app before restoring and restore ownership to the service user.

On every start, the app sorts the `.sql` files in `migrations/` by filename and applies the ones absent from `_migrations`. Each migration and its tracking row run in one transaction, with rollback on failure. Keep `migrations/` with the application and back up before upgrading.

## Reverse proxy and TLS

Point your domain at the server. Caddy can obtain and renew its TLS certificate automatically when the domain and public ports are configured correctly. A minimal Caddyfile for a single direct proxy is:

```caddyfile
cumplista.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

For nginx, obtain a certificate first and adjust its paths:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name cumplista.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name cumplista.example.com;
    ssl_certificate /etc/letsencrypt/live/cumplista.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cumplista.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

Set `APP_URL=https://cumplista.example.com` and `TRUST_PROXY=1`. Node trusts the **last nonempty comma-separated value** in `X-Forwarded-For`. It falls back to the socket address if that header is absent or empty. It does not use `X-Real-IP` or `CF-Connecting-IP`. Without proxy trust, visitors share the proxy's address for IP rate limits.

The proxy must set `X-Forwarded-For` and must not let clients spoof it. Caddy replaces an untrusted incoming `X-Forwarded-For` with the real peer address by default, and the nginx example does the same with `proxy_set_header X-Forwarded-For $remote_addr`. If you add another proxy in front, configure it to be trusted.

**Keep the app reachable only through the proxy.** With `TRUST_PROXY=1`, anyone who can reach Node's port directly can send a forged `X-Forwarded-For` header and slip past the per-client rate limits. Set `HOST=127.0.0.1` so Node listens on loopback only, and keep the port closed in your firewall as well. In the Docker setup below, the compose file publishes the port on loopback only.

## Run as a systemd service

On a Linux host with systemd, create a dedicated user and data directory:

```sh
sudo useradd --system --home-dir /var/lib/cumplista --shell /usr/sbin/nologin cumplista
sudo install -d -o cumplista -g cumplista -m 700 /var/lib/cumplista
```

Place the checkout in `/opt/cumplista` and install dependencies there with `npm ci --include=dev`. Keep the code readable by `cumplista`, and create `/etc/cumplista.env` as above. Save this as `/etc/systemd/system/cumplista.service`, adjusting `/usr/bin/node` to your installed Node 24+ binary:

```ini
[Unit]
Description=Cumplista
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=cumplista
Group=cumplista
WorkingDirectory=/opt/cumplista
EnvironmentFile=/etc/cumplista.env
ExecStart=/usr/bin/node --import tsx src/entry-node.ts
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/cumplista
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
```

The writable data directory permits SQLite's WAL files. Do not enable `MemoryDenyWriteExecute`: Node's JIT needs executable memory. Install Node outside a protected home directory.

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now cumplista
sudo journalctl -u cumplista -f
```

`npm start` runs `tsx src/entry-node.ts`. The unit runs Node directly with the `tsx` import hook so systemd supervises the application process. Both run TypeScript at runtime; there is no build step. `tsx` is a development dependency, so do not install with `--omit=dev`. `npm run dev:node` adds file watching and is for development. `npm run dev` starts Wrangler instead.

## Docker

Save the following as `Dockerfile` in your checkout:

```dockerfile
FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
COPY public ./public
RUN mkdir /data && chown node:node /data
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
USER node
EXPOSE 8787
CMD ["node", "--import", "tsx", "src/entry-node.ts"]
```

Copy your production environment settings to a private `.env.production` file beside it, but leave `HOST` out. Inside a container the app must listen on every interface, and the compose file below already restricts the published port to loopback. Save this as `docker-compose.yml`:

```yaml
services:
  cumplista:
    build: .
    restart: unless-stopped
    env_file: .env.production
    environment:
      PORT: "8787"
      DATA_DIR: /data
    ports:
      - "127.0.0.1:8787:8787"
    volumes:
      - cumplista-data:/data

volumes:
  cumplista-data:
```

Use a host reverse proxy from the previous section:

```sh
docker compose up -d --build
curl -fsS http://localhost:8787/healthz
docker compose logs --tail=50
```

The named volume keeps the database across container replacement. A bind mount instead requires its directory to be writable by the container's `node` user. The Dockerfile copies only application inputs, so environment files and existing databases are not included in the image. Keep `.env.production` out of source control.

## Mail without Cloudflare

Mail is used only for password resets, not for sign-up confirmation or list invitations. Owners share invite links themselves. Reset requests use `/forgot`; links use `/reset/:token` and expire after one hour.

- `MAIL_DRIVER=console` logs one JSON object to standard output with `channel`, `from`, `to`, `subject` and `text`, including the reset link. It sends no email. Use it only for development; reset links in logs grant access to an account.
- `MAIL_DRIVER=smtp` needs `SMTP_URL` and a suitable `MAIL_FROM`. The URL is passed directly to Nodemailer's `createTransport`. Use `smtps://user:password@smtp.example.com:465` for implicit TLS, or `smtp://user:password@smtp.example.com:587?requireTLS=true` to require STARTTLS. Percent-encode reserved characters in usernames and passwords, for example `@` as `%40`.
- `MAIL_DRIVER=resend` needs `RESEND_API_KEY` and a `MAIL_FROM` accepted by Resend. The adapter posts to `https://api.resend.com/emails` with a 10-second timeout.

The send-time errors for missing credentials are `SMTP_URL is required when MAIL_DRIVER=smtp` and `RESEND_API_KEY is required when MAIL_DRIVER=resend`. The password reset route hides delivery failures to avoid exposing which accounts exist. A successful `/forgot` response does not prove delivery.

## Updating and troubleshooting

Back up first, then update the checkout and restart:

```sh
cd /opt/cumplista
git pull --ff-only
npm ci --include=dev
sudo systemctl restart cumplista
curl -fsS http://localhost:8787/healthz
```

Migrations apply on startup. With Docker, pull the code and run `docker compose up -d --build` instead. Keep the data volume. Do not use `docker compose down -v` unless you intend to delete it. Check logs and sign in after updating; `/healthz` alone does not verify data or mail.

| Symptom | Cause and action |
| --- | --- |
| Form POST returns `403 Forbidden` | The supplied `Origin` differs from `APP_URL`'s origin. Match the public scheme, hostname and port. Requests without an `Origin` header are allowed. |
| Login redirects but cookies do not persist over HTTP | An HTTPS `APP_URL` sets `Secure` on cookies. Use HTTPS publicly, or an HTTP `APP_URL` for local HTTP testing. |
| Request returns `500` and logs `database is locked` | Another connection holds a write lock past the 5-second busy timeout. End the blocking transaction, and do not delete WAL files. |
| Startup fails with `EADDRINUSE` | Another process owns the port. Stop that process or choose another `PORT` and update the proxy. |
| Startup says the session secret is missing or too short | Check the service's environment file and use at least 32 characters. The exact messages are listed above. |

The systemd, Caddy and nginx snippets are templates. Adjust paths, users and certificates to your system.

See [Configuration](configuration.md) and [Integrations](integrations.md).
