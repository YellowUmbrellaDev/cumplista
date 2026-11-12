// Everything platform specific hides behind these three ports. Workers wires
// D1 + fetch mailer, Node wires node:sqlite + SMTP or fetch mailer.

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

export type Env = {
  APP_URL: string;
  SESSION_SECRET: string;
  MAIL_FROM: string;
  MAIL_DRIVER: "console" | "resend" | "smtp";
  RESEND_API_KEY?: string;
  SMTP_URL?: string;
};

export type Deps = { sql: Sql; mailer: Mailer; env: Env; now: () => Date };
