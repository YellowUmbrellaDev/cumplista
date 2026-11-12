import type { Deps } from "../ports.js";
import type { Result } from "./types.js";

export const DAY_MS = 24 * 60 * 60 * 1000;

export type AttemptRow = {
  kind: string;
  scope: string;
  client: string;
  at: number;
};

export type RateRule = {
  kind: string;
  scope: string | null;
  client: string | null;
  limit: number;
  windowMs: number;
};

export type RateTicket = {
  release: () => Promise<void>;
};

export async function take(
  deps: Deps,
  row: AttemptRow,
  rules: readonly RateRule[],
): Promise<Result<RateTicket, "limited">> {
  let res: { changes: number };

  if (rules.length === 0) {
    res = await deps.sql.run(
      `INSERT INTO attempts (kind, scope, client, at) VALUES (?, ?, ?, ?)`,
      row.kind,
      row.scope,
      row.client,
      row.at,
    );
  } else {
    const clauses: string[] = [];
    const params: unknown[] = [row.kind, row.scope, row.client, row.at];

    for (const rule of rules) {
      const cutoff = row.at - rule.windowMs;
      const whereParts = ["kind = ?"];
      params.push(rule.kind);
      if (rule.scope !== null) {
        whereParts.push("scope = ?");
        params.push(rule.scope);
      }
      if (rule.client !== null) {
        whereParts.push("client = ?");
        params.push(rule.client);
      }
      whereParts.push("at > ?");
      params.push(cutoff, rule.limit);
      clauses.push(`(SELECT COUNT(*) FROM attempts WHERE ${whereParts.join(" AND ")}) < ?`);
    }

    res = await deps.sql.run(
      `INSERT INTO attempts (kind, scope, client, at)
       SELECT ?, ?, ?, ?
       WHERE ${clauses.join(" AND ")}`,
      ...params,
    );
  }

  if (Math.random() < 0.05) {
    await deps.sql.run(`DELETE FROM attempts WHERE at <= ?`, row.at - DAY_MS);
  }

  if (res.changes === 0) {
    return { ok: false, error: "limited" };
  }

  let released = false;
  return {
    ok: true,
    value: {
      async release(): Promise<void> {
        if (released) return;
        released = true;
        await deps.sql.run(
          `DELETE FROM attempts
           WHERE rowid = (
             SELECT rowid FROM attempts
             WHERE kind = ? AND scope = ? AND client = ? AND at = ?
             LIMIT 1
           )`,
          row.kind,
          row.scope,
          row.client,
          row.at,
        );
      },
    },
  };
}
