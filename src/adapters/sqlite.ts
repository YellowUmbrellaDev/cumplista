import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { Sql } from "../ports.js";

export type SqliteSql = Sql & { close(): void };

const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations", import.meta.url));

export function resolveSqlitePath(target?: string): string {
  const raw = target?.trim();
  if (!raw) return join("./data", "cumplista.db");
  if (raw === ":memory:") return ":memory:";
  const ext = extname(raw).toLowerCase();
  if (ext === ".db" || ext === ".sqlite" || ext === ".sqlite3") return raw;
  return join(raw, "cumplista.db");
}

function toSqlInput(value: unknown): SQLInputValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return value;
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Uint8Array) return value;
  throw new TypeError(`Unsupported SQLite parameter type: ${typeof value}`);
}

function applyMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const hasMigration = db.prepare("SELECT 1 FROM _migrations WHERE name = ?");
  const recordMigration = db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)");

  for (const file of files) {
    if (hasMigration.get(file) !== undefined) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      recordMigration.run(file, new Date().toISOString());
      db.exec("COMMIT");
    } catch (err) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw err;
    }
  }
}

export function createSqliteSql(target?: string): SqliteSql {
  const resolved = resolveSqlitePath(target ?? process.env.DATA_DIR);
  if (resolved !== ":memory:") {
    mkdirSync(dirname(resolved), { recursive: true });
  }

  const db = new DatabaseSync(resolved, { enableForeignKeyConstraints: true });
  db.exec("PRAGMA foreign_keys = ON;");
  if (resolved !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  }
  applyMigrations(db);

  return {
    async all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
      const rows = db.prepare(sql).all(...params.map(toSqlInput));
      return rows.map((row) => ({ ...row }) as T);
    },
    async first<T>(sql: string, ...params: unknown[]): Promise<T | null> {
      const row = db.prepare(sql).get(...params.map(toSqlInput));
      return row === undefined ? null : ({ ...row } as T);
    },
    async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
      const result = db.prepare(sql).run(...params.map(toSqlInput));
      return { changes: Number(result.changes) };
    },
    async batch(statements: { sql: string; params: unknown[] }[]): Promise<void> {
      if (statements.length === 0) return;
      db.exec("BEGIN");
      try {
        for (const entry of statements) {
          db.prepare(entry.sql).run(...entry.params.map(toSqlInput));
        }
        db.exec("COMMIT");
      } catch (err) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw err;
      }
    },
    close(): void {
      if (db.isOpen) db.close();
    },
  };
}
