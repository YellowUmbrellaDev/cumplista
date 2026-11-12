import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { createD1Sql, type D1Database, type D1PreparedStatement } from "../src/adapters/d1.js";
import { createMailer, sendMail } from "../src/adapters/mail.js";
import { createSqliteSql } from "../src/adapters/sqlite.js";
import { ipBucket } from "../src/domain/ip.js";
import { resolveNodeClientIp } from "../src/entry-node.js";
import workerEntry, { buildWorkerEnv, resolveWorkerClientIp } from "../src/entry-worker.js";

function toSqlParam(value: unknown): SQLInputValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return value;
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  throw new TypeError(`Unsupported param: ${typeof value}`);
}

function fakeD1OverSqlite(): { d1: D1Database; close: () => void } {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE kv (k TEXT PRIMARY KEY, v INTEGER NOT NULL);");

  const makeStmt = (query: string, bound: unknown[] = []): D1PreparedStatement => ({
    bind(...values: unknown[]) {
      return makeStmt(query, values);
    },
    async all<T = Record<string, unknown>>() {
      const rows = db.prepare(query).all(...bound.map(toSqlParam));
      return { results: rows.map((r) => ({ ...r }) as T) };
    },
    async first<T = Record<string, unknown>>() {
      const row = db.prepare(query).get(...bound.map(toSqlParam));
      return row === undefined ? null : ({ ...row } as T);
    },
    async run() {
      const res = db.prepare(query).run(...bound.map(toSqlParam));
      return { meta: { changes: Number(res.changes) } };
    },
  });

  return {
    d1: {
      prepare(query: string) {
        return makeStmt(query);
      },
      async batch(statements: D1PreparedStatement[]) {
        const out: unknown[] = [];
        for (const s of statements) {
          out.push(await s.run());
        }
        return out;
      },
    },
    close: () => db.close(),
  };
}

describe("Adapters", () => {
  it("applies sqlite migrations idempotently on file DB and enforces foreign keys", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cumplista-sqlite-"));
    try {
      const first = createSqliteSql(dir);
      const fk = await first.first<{ foreign_keys: number }>("PRAGMA foreign_keys");
      expect(fk?.foreign_keys).toBe(1);

      const applied = await first.all<{ name: string }>(
        "SELECT name FROM _migrations ORDER BY name ASC",
      );
      expect(applied.map((r) => r.name)).toEqual(["0001_init.sql"]);
      first.close();

      const reopened = createSqliteSql(dir);
      const appliedAgain = await reopened.all<{ name: string }>(
        "SELECT name FROM _migrations ORDER BY name ASC",
      );
      expect(appliedAgain.map((r) => r.name)).toEqual(["0001_init.sql"]);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adapts D1Database positional queries and batch execution", async () => {
    const { d1, close } = fakeD1OverSqlite();
    try {
      const sql = createD1Sql(d1);
      await sql.batch([]);
      await sql.batch([
        { sql: "INSERT INTO kv (k, v) VALUES (?, ?)", params: ["a", 1] },
        { sql: "INSERT INTO kv (k, v) VALUES (?, ?)", params: ["b", 2] },
      ]);

      const one = await sql.first<{ k: string; v: number }>(
        "SELECT k, v FROM kv WHERE k = ?",
        "a",
      );
      expect(one).toEqual({ k: "a", v: 1 });

      const missing = await sql.first<{ k: string; v: number }>(
        "SELECT k, v FROM kv WHERE k = ?",
        "z",
      );
      expect(missing).toBeNull();

      const updated = await sql.run("UPDATE kv SET v = ? WHERE k = ?", 10, "a");
      expect(updated).toEqual({ changes: 1 });

      const rows = await sql.all<{ k: string; v: number }>(
        "SELECT k, v FROM kv ORDER BY k ASC",
      );
      expect(rows).toEqual([
        { k: "a", v: 10 },
        { k: "b", v: 2 },
      ]);
    } finally {
      close();
    }
  });

  it("sends Resend HTTP payload, strips control chars from subjects, and turns mail errors into false", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "re_123" }), { status: 200 }),
    );

    try {
      const resendMailer = createMailer({
        APP_URL: "http://localhost:8787",
        SESSION_SECRET: "secret",
        MAIL_FROM: "Cumplista <noreply@example.com>",
        MAIL_DRIVER: "resend",
        RESEND_API_KEY: "re_test_key",
      });

      const ok = await sendMail(resendMailer, {
        to: "guest@example.com",
        subject: "Invite\r\nBcc: x@y.z\u0000\u007f",
        text: "Hello",
        html: "<p>Hello</p>",
      });
      expect(ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = fetchSpy.mock.calls[0] ?? [];
      expect(calledUrl).toBe("https://api.resend.com/emails");
      expect(calledInit?.method).toBe("POST");
      expect(JSON.parse(String(calledInit?.body))).toEqual({
        from: "Cumplista <noreply@example.com>",
        to: ["guest@example.com"],
        subject: "InviteBcc: x@y.z",
        text: "Hello",
        html: "<p>Hello</p>",
      });

      fetchSpy.mockResolvedValueOnce(new Response("rate limited", { status: 429 }));
      const failed = await sendMail(resendMailer, {
        to: "guest@example.com",
        subject: "Invite",
        text: "Hello",
        html: "<p>Hello</p>",
      });
      expect(failed).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("normalizes IPv4, IPv4-mapped IPv6, IPv6 /64 prefixes, and missing inputs in ipBucket", () => {
    expect(ipBucket(undefined)).toBe("unknown");
    expect(ipBucket(null)).toBe("unknown");
    expect(ipBucket("")).toBe("unknown");
    expect(ipBucket("   ")).toBe("unknown");
    expect(ipBucket("not-an-ip")).toBe("unknown");
    expect(ipBucket("999.0.0.1")).toBe("unknown");

    expect(ipBucket("203.0.113.10")).toBe("203.0.113.10");
    expect(ipBucket("203.0.113.10:54321")).toBe("203.0.113.10");
    expect(ipBucket("::ffff:203.0.113.10")).toBe("203.0.113.10");

    expect(ipBucket("2001:db8:abcd:ef::1")).toBe("2001:0db8:abcd:00ef/64");
    expect(ipBucket("2001:db8:abcd:ef:1111:2222:3333:4444")).toBe("2001:0db8:abcd:00ef/64");
    expect(ipBucket("[2001:db8::1]:8443")).toBe("2001:0db8:0000:0000/64");
    expect(ipBucket("fe80::1%eth0")).toBe("fe80:0000:0000:0000/64");
    expect(ipBucket("::1")).toBe("0000:0000:0000:0000/64");

    expect(ipBucket("2001:db8:abcd:1::1", { ipv6Prefix: 48 })).toBe("2001:0db8:abcd/48");
    expect(ipBucket("2001:db8:abcd:9999::42", { ipv6Prefix: 48 })).toBe("2001:0db8:abcd/48");
    expect(ipBucket("::ffff:203.0.113.10", { ipv6Prefix: 48 })).toBe("203.0.113.10");
  });

  it("resolves client IPs per runtime without trusting forged forwarded headers by default", () => {
    const forgedReq = new Request("https://gifts.example.com/l/abc/join", {
      headers: {
        "cf-connecting-ip": "198.51.100.25",
        "x-forwarded-for": "192.0.2.1, 203.0.113.77",
      },
    });

    expect(resolveWorkerClientIp(forgedReq)).toBe("198.51.100.25");
    expect(
      resolveWorkerClientIp(
        new Request("https://gifts.example.com/l/abc/join", {
          headers: { "x-forwarded-for": "192.0.2.1" },
        }),
      ),
    ).toBe("");

    const nodeRuntime = {
      incoming: {
        socket: {
          remoteAddress: "::ffff:198.51.100.42",
        },
      },
    };
    expect(resolveNodeClientIp(forgedReq, nodeRuntime, false)).toBe("::ffff:198.51.100.42");
    expect(resolveNodeClientIp(forgedReq, nodeRuntime, true)).toBe("203.0.113.77");

    const plainReq = new Request("http://localhost:8787/l/abc/join");
    expect(resolveNodeClientIp(plainReq, { server: nodeRuntime }, true)).toBe(
      "::ffff:198.51.100.42",
    );
  });

  it("fails closed in buildWorkerEnv when required Worker bindings are missing or unsafe", () => {
    const validProd = {
      APP_URL: "https://gifts.example.com",
      SESSION_SECRET: "prod-session-secret-value-at-least-32-chars",
      MAIL_DRIVER: "resend",
      MAIL_FROM: "Cumplista <noreply@gifts.example.com>",
      RESEND_API_KEY: "re_live_key",
    };

    expect(buildWorkerEnv(validProd)).toEqual({
      APP_URL: "https://gifts.example.com",
      SESSION_SECRET: "prod-session-secret-value-at-least-32-chars",
      MAIL_DRIVER: "resend",
      MAIL_FROM: "Cumplista <noreply@gifts.example.com>",
      RESEND_API_KEY: "re_live_key",
    });

    const { SESSION_SECRET: _missingSecret, ...noSecret } = validProd;
    expect(() => buildWorkerEnv(noSecret)).toThrow(/SESSION_SECRET/);
    expect(() => buildWorkerEnv({ ...validProd, SESSION_SECRET: "x".repeat(31) })).toThrow(
      /SESSION_SECRET/,
    );

    const { APP_URL: _missingUrl, ...noUrl } = validProd;
    expect(() => buildWorkerEnv(noUrl)).toThrow(/APP_URL/);
    expect(() => buildWorkerEnv({ ...validProd, APP_URL: "http://gifts.example.com" })).toThrow(
      /https:/,
    );
    expect(() => buildWorkerEnv({ ...validProd, APP_URL: "http://localhost:8787" })).toThrow(
      /Loopback APP_URL/,
    );
    expect(() => buildWorkerEnv({ ...validProd, APP_URL: "http://127.0.0.1:8787" })).toThrow(
      /Loopback APP_URL/,
    );

    const { MAIL_DRIVER: _missingDriver, ...noDriver } = validProd;
    expect(() => buildWorkerEnv(noDriver)).toThrow(/MAIL_DRIVER/);
    expect(() => buildWorkerEnv({ ...validProd, MAIL_DRIVER: "invalid" })).toThrow(/MAIL_DRIVER/);
    expect(() => buildWorkerEnv({ ...validProd, MAIL_DRIVER: "smtp" })).toThrow(/smtp/);
    expect(() => buildWorkerEnv({ ...validProd, MAIL_DRIVER: "console" })).toThrow(
      /ALLOW_CONSOLE_MAIL/,
    );
    expect(() =>
      buildWorkerEnv({ ...validProd, MAIL_DRIVER: "console", ALLOW_CONSOLE_MAIL: "1" }),
    ).toThrow(/loopback/i);

    const { MAIL_FROM: _missingFrom, ...noFrom } = validProd;
    expect(() => buildWorkerEnv(noFrom)).toThrow(/MAIL_FROM/);

    const { RESEND_API_KEY: _missingResend, ...noResendKey } = validProd;
    expect(() => buildWorkerEnv(noResendKey)).toThrow(/RESEND_API_KEY/);

    expect(
      buildWorkerEnv({
        APP_URL: "http://localhost:8787",
        MAIL_DRIVER: "console",
        ALLOW_CONSOLE_MAIL: "1",
        SESSION_SECRET: "dev-only-change-me-at-least-32-chars",
      }),
    ).toEqual({
      APP_URL: "http://localhost:8787",
      MAIL_DRIVER: "console",
      MAIL_FROM: "Cumplista <hola@localhost>",
      SESSION_SECRET: "dev-only-change-me-at-least-32-chars",
    });
  });

  it("handles Worker fetch requests when configured and rejects missing Worker config", async () => {
    const { d1, close } = fakeD1OverSqlite();
    try {
      await expect(
        workerEntry.fetch(new Request("https://gifts.example.com/healthz"), { DB: d1 }),
      ).rejects.toThrow(/SESSION_SECRET/);

      const okRes = await workerEntry.fetch(new Request("https://gifts.example.com/healthz"), {
        DB: d1,
        APP_URL: "https://gifts.example.com",
        SESSION_SECRET: "prod-session-secret-value-at-least-32-chars",
        MAIL_DRIVER: "resend",
        MAIL_FROM: "Cumplista <noreply@gifts.example.com>",
        RESEND_API_KEY: "re_live_key",
      });
      expect(okRes.status).toBe(200);
      expect(await okRes.text()).toBe("ok");
    } finally {
      close();
    }
  });
});
