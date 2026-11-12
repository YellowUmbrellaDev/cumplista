import type { Env, Mail, Mailer } from "../ports.js";

type SmtpTransporter = {
  sendMail(options: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
};

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

export function createMailer(env: Env): Mailer {
  let smtpTransporter: Promise<SmtpTransporter> | null = null;

  return {
    async send(mail: Mail): Promise<void> {
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
        case "resend": {
          if (!env.RESEND_API_KEY) {
            throw new Error("RESEND_API_KEY is required when MAIL_DRIVER=resend");
          }
          const response = await fetch("https://api.resend.com/emails", {
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
          });
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
    await mailer.send(mail);
    return true;
  } catch {
    return false;
  }
}
