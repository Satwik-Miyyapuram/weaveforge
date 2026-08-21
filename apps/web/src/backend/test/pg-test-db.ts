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

const MIGRATIONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../supabase/migrations",
);

/**
 * The Supabase-managed objects the migrations reference but do not create.
 *
 * Deliberately minimal: enough shape for the migrations to apply and for
 * `auth.uid()` to answer, and nothing that would let a stub stand in for a
 * policy under test.
 */
const BOOTSTRAP = `
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists realtime;
create schema if not exists extensions;
grant usage on schema public, auth, storage, realtime to anon, authenticated, service_role;
-- Supabase grants table privileges to these roles by default, so RLS — not the
-- grant — is what a policy test is actually exercising. Without this every
-- query fails with "permission denied" long before a policy is consulted.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);

-- What PostgREST does per request, and what every policy reads.
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid $$;

create table if not exists storage.buckets (id text primary key, name text, public boolean default false);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb, created_at timestamptz default now()
);
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select string_to_array(name, '/') $$;

create table if not exists realtime.messages (
  id uuid primary key default gen_random_uuid(),
  topic text, extension text, payload jsonb, inserted_at timestamptz default now()
);
alter table realtime.messages enable row level security;
create or replace function realtime.topic() returns text language sql stable as $$
  select current_setting('realtime.topic', true) $$;
`;

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
  await db.exec(BOOTSTRAP);
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort()) {
    try {
      await db.exec(readFileSync(path.join(MIGRATIONS, file), "utf8"));
    } catch (error) {
      throw new Error(`Migration ${file} failed on a clean database: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const sql = async <T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> =>
    (await db.query<T>(query, params)).rows;

  return {
    sql,
    async createUser(email = `${crypto.randomUUID()}@test.invalid`) {
      const [row] = await sql<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
      return row!.id;
    },
    as(userId: string) {
      const claims = JSON.stringify({ sub: userId, role: "authenticated" });
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
