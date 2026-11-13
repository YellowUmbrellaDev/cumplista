// Everything platform specific hides behind these ports. Workers wires D1, the
// send_email binding and fetch. Node wires node:sqlite, SMTP or fetch.

export interface Sql {
  all<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  first<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
  batch(statements: { sql: string; params: unknown[] }[]): Promise<void>;
}

export type Mail = { to: string; subject: string; text: string; html: string };

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

// siteKey is null when Turnstile is not configured. Then no widget is rendered
// and verify always resolves true.
export interface Captcha {
  siteKey: string | null;
  verify(token: string, ip: string): Promise<boolean>;
}

export type GoogleProfile = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
};

// enabled is false when GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is unset.
export interface GoogleAuth {
  enabled: boolean;
  authorizeUrl(params: { state: string; codeChallenge: string }): string;
  exchange(params: { code: string; codeVerifier: string }): Promise<GoogleProfile | null>;
}

export type Env = {
  APP_URL: string;
  SESSION_SECRET: string;
  MAIL_FROM: string;
  MAIL_DRIVER: "console" | "cloudflare" | "resend" | "smtp";
  RESEND_API_KEY?: string;
  SMTP_URL?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

export type Deps = {
  sql: Sql;
  mailer: Mailer;
  captcha: Captcha;
  google: GoogleAuth;
  env: Env;
  now: () => Date;
  clientIp: (req: Request, runtime: unknown) => string;
};
