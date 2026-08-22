/**
 * The parts of "a Postgres that is not Supabase's" that more than one place needs.
 *
 * The test database and the desktop app's local database are the same thing
 * built for different reasons: real Postgres, the shipped migrations, and the
 * handful of Supabase-managed objects the migrations reference but do not
 * create. Keeping the SQL and the apply loop here means a migration that needs
 * a new piece of scaffolding gets it once, and the two callers cannot drift
 * into disagreeing about what a clean database looks like.
 *
 * No import of PGlite, or of node's fs: the caller passes in something that can
 * run SQL and something that can list migrations, so this file stays usable
 * from a browser bundle and from an Electron main process alike.
 */

/**
 * Who owns rows written before anybody signs in.
 *
 * Row-level security is written against `auth.uid()`, so an app with no account
 * would either have to run without policies — every one of them inert — or
 * answer that question with something. It answers with this: a fixed uuid that
 * exists only on this device. Policies then behave identically whether or not
 * an account exists, and turning sync on later is a re-owning of rows rather
 * than a change of security model.
 *
 * Fixed rather than generated, so a reinstall that keeps the data directory
 * finds its own rows again. Version 4 with the `weaveforge` nibbles is a
 * deliberate tell: a row owned by this id never came from a real signup.
 */
export const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000001";

/**
 * The Supabase-managed objects the migrations reference but do not create.
 *
 * Deliberately minimal: enough shape for the migrations to apply and for
 * `auth.uid()` to answer, and nothing that would let a stub stand in for a
 * policy under test.
 */
export const LOCAL_BOOTSTRAP_SQL = `
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

/** One migration, named the way the file is named so an error can say which. */
export interface Migration {
  readonly name: string;
  readonly sql: string;
}

/**
 * Apply migrations in the given order, skipping any this database already ran.
 *
 * The order is the caller's, and it is applied as given. Sorting here would be
 * a second opinion about it, and it would be wrong for a caller that draws from
 * more than one directory — where the order between directories is a decision,
 * not something a name comparison can recover.
 *
 * `applied` is asked once and answered from whatever bookkeeping the caller
 * keeps — a table on disk for the desktop app, an empty set for a database
 * built fresh per test process. A migration that fails names itself, because
 * the alternative is a stack trace from deep inside Postgres with no hint of
 * which of a hundred files produced it.
 */
export async function applyMigrations(
  migrations: readonly Migration[],
  exec: (sql: string) => Promise<unknown>,
  options: { applied?: ReadonlySet<string>; onApplied?: (name: string) => Promise<void> } = {},
): Promise<string[]> {
  const applied = options.applied ?? new Set<string>();
  const ran: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    try {
      await exec(migration.sql);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Migration ${migration.name} failed on a clean database: ${reason}`);
    }
    await options.onApplied?.(migration.name);
    ran.push(migration.name);
  }
  return ran;
}

/**
 * The transaction-local settings a query needs before RLS means anything.
 *
 * Both travel with the query or neither does: outside a transaction
 * `auth.uid()` is null again by the time the statement runs. `null` for the
 * user is a request with no identity, which policies are entitled to refuse.
 */
export function sessionClaims(userId: string | null): string {
  return JSON.stringify(userId ? { sub: userId, role: "authenticated" } : { role: "anon" });
}
