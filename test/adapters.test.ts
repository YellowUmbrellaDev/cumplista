import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { createD1Sql, type D1Database, type D1PreparedStatement } from "../src/adapters/d1.js";
import { createMailer, sendMail } from "../src/adapters/mail.js";
import { createSqliteSql } from "../src/adapters/sqlite.js";

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

  it("sends Resend HTTP payload and turns mail errors into false via sendMail", async () => {
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
        subject: "Invite",
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
        subject: "Invite",
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
});
