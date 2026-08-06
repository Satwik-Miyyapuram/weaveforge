-- OCI / self-hosted Postgres only. Applied BEFORE supabase/migrations/*.
--
-- A stock Postgres has none of the furniture Supabase provides implicitly, and
-- the base migrations use it from the very first file: `auth.users` in a
-- foreign key, `auth.uid()` in every RLS policy, `storage.buckets` for the
-- image buckets, and grants to the `anon` / `authenticated` / `service_role`
-- roles. Without this file `0001_papers.sql` fails on line 28 and nothing else
-- runs.
--
-- Everything here is a stub with the same shape, not a reimplementation.
-- Authentication still happens in Supabase Auth; this database only needs the
-- names to resolve so that the schema, its constraints, and its policies can be
-- created and enforced.

-- ---------------------------------------------------------------- roles
-- Supabase creates these; PostgREST assumes them. They are referenced by
-- `grant ... to authenticated` throughout the base migrations. Created NOLOGIN:
-- they exist to be granted to and to be switched into, never to connect as.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- Bypasses RLS, exactly as on Supabase: sync jobs and admin paths use it.
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- ----------------------------------------------------------------- auth
create schema if not exists auth;

-- Columns are the subset the base migrations actually read. `raw_user_meta_data`
-- is not optional: 0015 seeds `profiles.full_name` out of it, both in its
-- trigger and in its backfill.
create table if not exists auth.users (
  id                 uuid primary key,
  email              text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

alter table auth.users add column if not exists raw_user_meta_data jsonb not null default '{}'::jsonb;

/**
 * The current user id, read from the transaction-local claim.
 *
 * `apps/web/src/backend/providers/postgres/pg-runner.ts` sets
 * `request.jwt.claim.sub` with `set_config(..., true)` per transaction, so this
 * returns null outside one — which fails every RLS policy closed rather than
 * open. That is the intended behaviour for a connection that has not said who
 * it is.
 */
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
$$;

-- -------------------------------------------------------------- storage
-- Supabase Storage's tables. The self-hosted deployment serves blobs from R2
-- and MinIO instead, but the base migrations create buckets and write RLS
-- policies against `storage.objects`, so the shapes have to exist for those
-- statements to succeed.
create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  owner              uuid,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id             uuid primary key default gen_random_uuid(),
  bucket_id      text references storage.buckets(id),
  name           text,
  owner          uuid,
  metadata       jsonb,
  path_tokens    text[],
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  last_accessed_at timestamptz
);

alter table storage.objects enable row level security;

/**
 * Path segments of an object name, as Supabase's helper returns them.
 *
 * Storage policies are written as `storage.foldername(name)[1] = auth.uid()::text`,
 * so the indexing convention matters: element 1 is the first segment, and the
 * final segment (the filename) is dropped.
 */
create or replace function storage.foldername(name text)
returns text[]
language plpgsql
immutable
as $$
declare
  parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1:array_length(parts, 1) - 1];
end
$$;

-- `gen_random_uuid()` is core since Postgres 13, but the extension is what
-- Supabase images ship and some migrations assume its presence.
create extension if not exists pgcrypto;

-- ------------------------------------------------------------- realtime
-- Supabase Realtime's authorization surface. The self-hosted deployment does
-- not run Realtime — collaboration falls back to polling — but 0044 writes RLS
-- policies against `realtime.messages`, and a policy cannot be created on a
-- table that does not exist.
--
-- The shape is Realtime's, so the policies mean what they say if Realtime is
-- ever pointed at this database. Nothing writes to it otherwise.
create schema if not exists realtime;

create table if not exists realtime.messages (
  id         uuid primary key default gen_random_uuid(),
  topic      text not null,
  extension  text not null,
  payload    jsonb,
  event      text,
  private    boolean not null default false,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table realtime.messages enable row level security;

/** The channel a broadcast is on, read from the transaction-local setting. */
create or replace function realtime.topic()
returns text
language sql
stable
as $$
  select nullif(current_setting('realtime.topic', true), '');
$$;
