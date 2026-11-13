import type { Env, Mail, Mailer } from "../ports.js";

export type EmailBinding = {
  send(msg: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
};

type SmtpTransporter = {
  sendMail(options: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
};

const RESEND_TIMEOUT_MS = 10_000;
const SUBJECT_CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g;

function hasCreateTransport(
  mod: unknown,
): mod is { createTransport: (url: string) => SmtpTransporter } {
  return (
    typeof mod === "object" &&
    mod !== null &&
    "createTransport" in mod &&
    typeof mod.createTransport === "function"
  );
}

function sanitizeMail(mail: Mail): Mail {
  return {
    ...mail,
    subject: mail.subject.replace(SUBJECT_CONTROL_CHARS, ""),
  };
}

async function fetchWithTimeout(
  fetchFn: typeof fetch | undefined,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`Mail request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    const doFetch: typeof fetch =
      fetchFn ?? ((input, reqInit) => globalThis.fetch(input, reqInit));
    const pending = Promise.resolve().then(() =>
      doFetch(url, { ...init, signal: controller.signal }),
    );
    return await Promise.race([pending, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createMailer(
  env: Env,
  bindings?: { EMAIL?: EmailBinding | undefined },
  fetchFn?: typeof fetch,
): Mailer {
  let smtpTransporter: Promise<SmtpTransporter> | null = null;

  return {
    async send(rawMail: Mail): Promise<void> {
      const mail = sanitizeMail(rawMail);
      switch (env.MAIL_DRIVER) {
        case "console": {
          console.info(
            JSON.stringify({
              channel: "mail",
              from: env.MAIL_FROM,
              to: mail.to,
              subject: mail.subject,
              text: mail.text,
            }),
          );
          return;
        }
        case "cloudflare": {
          if (!bindings?.EMAIL) {
            throw new Error("EMAIL binding is required when MAIL_DRIVER=cloudflare");
          }
          await bindings.EMAIL.send({
            from: env.MAIL_FROM,
            to: mail.to,
            subject: mail.subject,
            text: mail.text,
            html: mail.html,
          });
          return;
        }
        case "resend": {
          if (!env.RESEND_API_KEY) {
            throw new Error("RESEND_API_KEY is required when MAIL_DRIVER=resend");
          }
          const response = await fetchWithTimeout(
            fetchFn,
            "https://api.resend.com/emails",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${env.RESEND_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                from: env.MAIL_FROM,
                to: [mail.to],
                subject: mail.subject,
                text: mail.text,
                html: mail.html,
              }),
            },
            RESEND_TIMEOUT_MS,
          );
          if (!response.ok) {
            throw new Error(`Resend API returned HTTP ${response.status}`);
          }
          return;
        }
        case "smtp": {
          const smtpUrl = env.SMTP_URL;
          if (!smtpUrl) {
            throw new Error("SMTP_URL is required when MAIL_DRIVER=smtp");
          }
          // Non-literal specifier keeps Cloudflare Worker bundlers from pulling in nodemailer.
          smtpTransporter ??= (async () => {
            const pkg = ["node", "mailer"].join("");
            const mod: unknown = await import(pkg);
            if (!hasCreateTransport(mod)) {
              throw new Error("Failed to load nodemailer createTransport");
            }
            return mod.createTransport(smtpUrl);
          })();
          const transporter = await smtpTransporter;
          await transporter.sendMail({
            from: env.MAIL_FROM,
            to: mail.to,
            subject: mail.subject,
            text: mail.text,
            html: mail.html,
          });
          return;
        }
        default: {
          const exhaustive: never = env.MAIL_DRIVER;
          throw new Error(`Unsupported mail driver: ${String(exhaustive)}`);
        }
      }
    },
  };
}

export async function sendMail(mailer: Mailer, mail: Mail): Promise<boolean> {
  try {
    await mailer.send(sanitizeMail(mail));
    return true;
  } catch {
    return false;
  }
}
