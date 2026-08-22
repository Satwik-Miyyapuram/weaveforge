/**
 * A real Postgres for tests, with the password off.
 *
 * The RLS tests used to need a live Supabase project and two disposable user
 * accounts, so without secrets they self-skipped — which reads as "passing" in
 * CI while proving nothing. This runs the shipped migrations against PGlite
 * (Postgres compiled to WASM, in-process, no daemon and no credentials), then
 * lets a test act as a given user id.
 *
 * What it reproduces from Supabase is only the part policies are written
 * against: the `authenticated` role, and `auth.uid()` reading the `sub` claim
 * out of `request.jwt.claims`. Everything the policies actually evaluate —
 * every `using`, `with check`, trigger, CHECK constraint and security-invoker
 * function — is the real SQL from supabase/migrations. What it does not cover
 * is Supabase's own auth service: issuing a JWT, validating it, and mapping it
 * to a role. Those are GoTrue's job, not this schema's, and no test here
 * pretends otherwise.
 *
 * Applying every migration in order also means a migration that cannot run on
 * a clean database fails a test rather than a deploy.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { LOCAL_BOOTSTRAP_SQL, applyMigrations, sessionClaims } from "@weaveforge/core";

const MIGRATIONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../supabase/migrations",
);

export interface TestDb {
  /** Run SQL as the database owner, with RLS bypassed. */
  sql: <T = Record<string, unknown>>(query: string, params?: unknown[]) => Promise<T[]>;
  /** Create a user row and return its id, the way a signup would. */
  createUser: (email?: string) => Promise<string>;
  /** Run SQL as `authenticated` with `auth.uid()` answering this user id. */
  as: (userId: string) => Pick<TestDb, "sql">;
  close: () => Promise<void>;
}

/**
 * One database per process. Building it costs a couple of seconds, and node's
 * test runner already gives each file its own process, so per-file isolation
 * comes for free without paying for it per test.
 */
let shared: Promise<TestDb> | undefined;
export function testDb(): Promise<TestDb> {
  shared ??= build();
  return shared;
}

async function build(): Promise<TestDb> {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(LOCAL_BOOTSTRAP_SQL);
  const migrations = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => ({ name, sql: readFileSync(path.join(MIGRATIONS, name), "utf8") }));
  await applyMigrations(migrations, (sql) => db.exec(sql));

  const sql = async <T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> =>
    (await db.query<T>(query, params)).rows;

  return {
    sql,
    async createUser(email = `${crypto.randomUUID()}@test.invalid`) {
      const [row] = await sql<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
      return row!.id;
    },
    as(userId: string) {
      const claims = sessionClaims(userId);
      return {
        async sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
          // Both settings are transaction-local, so the claim, the role and the
          // query have to travel together — outside a transaction auth.uid() is
          // already null again by the time the query runs.
          return db.transaction(async (tx) => {
            await tx.query(
              "select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)",
              [claims],
            );
            return (await tx.query<T>(query, params)).rows;
          }) as Promise<T[]>;
        },
      };
    },
    async close() { await db.close(); },
  };
}
