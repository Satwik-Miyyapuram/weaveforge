/**
 * The Supabase-managed objects the migrations reference but do not create.
 *
 * Test-only: used by the PGlite test harness and the user-docs demo to build a
 * clean database. Deliberately minimal: enough shape for the migrations to apply
 * and for `auth.uid()` to answer, and nothing that would let a stub stand in for
 * a policy under test.
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
