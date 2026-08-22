import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { SqlRunner } from "../domain/outbox";

/**
 * The device-only tables in a real Postgres, and nothing else.
 *
 * The outbox and the watermark do not depend on the app's schema, so this
 * applies only `supabase/migrations-local` — which keeps these tests to a
 * second rather than the twenty the full migration set costs, and proves the
 * device-only migrations stand on their own.
 */
const LOCAL_MIGRATIONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../supabase/migrations-local",
);

export interface LocalSqlDb extends SqlRunner {
  close: () => Promise<void>;
}

export async function localSqlDb(): Promise<LocalSqlDb> {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec("create extension if not exists pgcrypto");
  for (const file of readdirSync(LOCAL_MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join(LOCAL_MIGRATIONS, file), "utf8"));
  }
  const query = async <T>(sql: string, params: (string | number | boolean | null)[] = []) =>
    (await db.query<T>(sql, params)).rows;
  return {
    query,
    queryOne: async <T>(sql: string, params: (string | number | boolean | null)[] = []) =>
      (await query<T>(sql, params))[0] ?? null,
    exec: async (sql, params = []) => {
      await query(sql, params);
    },
    close: () => db.close(),
  };
}

/**
 * The shared `pg-test-db` harness, seen as a `SqlRunner`.
 *
 * Tests that need the app's own schema use that database rather than the
 * device-only one above; this is the one adapter between the two shapes.
 */
export function sqlRunner(
  sql: (query: string, params?: unknown[]) => Promise<Record<string, unknown>[]>,
): SqlRunner {
  const query = async <T>(q: string, p: (string | number | boolean | null)[] = []) =>
    (await sql(q, p)) as T[];
  return {
    query,
    queryOne: async <T>(q: string, p: (string | number | boolean | null)[] = []) =>
      (await query<T>(q, p))[0] ?? null,
    exec: async (q, p = []) => {
      await query(q, p);
    },
  };
}
