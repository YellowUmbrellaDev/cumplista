import type { Sql } from "../ports.js";

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta: { changes?: number } }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

function normalizeParams(params: unknown[]): unknown[] {
  return params.map((value) => (value === undefined ? null : value));
}

function prepareBound(db: D1Database, sql: string, params: unknown[]): D1PreparedStatement {
  const statement = db.prepare(sql);
  return params.length > 0 ? statement.bind(...normalizeParams(params)) : statement;
}

export function createD1Sql(db: D1Database): Sql {
  return {
    async all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
      const result = await prepareBound(db, sql, params).all<T>();
      return result.results;
    },
    async first<T>(sql: string, ...params: unknown[]): Promise<T | null> {
      return prepareBound(db, sql, params).first<T>();
    },
    async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
      const result = await prepareBound(db, sql, params).run();
      return { changes: result.meta.changes ?? 0 };
    },
    async batch(statements: { sql: string; params: unknown[] }[]): Promise<void> {
      if (statements.length === 0) return;
      const prepared = statements.map((entry) => prepareBound(db, entry.sql, entry.params));
      await db.batch(prepared);
    },
  };
}
