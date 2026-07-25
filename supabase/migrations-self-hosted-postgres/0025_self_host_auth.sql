-- OCI / self-hosted Postgres only. NOT applied by `supabase db push`.
-- Run after copying supabase/migrations/0001–0024 to your OCI instance.
--
-- Sync auth.users rows from Supabase Auth (webhook or batch job). App sets
-- request.jwt.claim.sub per transaction (see apps/web/.../postgres/pg-runner.ts).

create schema if not exists auth;

create table if not exists auth.users (
  id         uuid primary key,
  email      text,
  created_at timestamptz not null default now()
);

alter table auth.users enable row level security;

revoke all on table auth.users from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table auth.users from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table auth.users from authenticated;
  end if;
end $$;

-- No permissive policies → anon/authenticated cannot read auth.users via PostgREST.
-- Sync jobs use service_role (bypasses RLS) or a direct postgres connection.

create or replace function auth.uid()
returns uuid
language sql
stable
set search_path = auth, public
as $$
  select nullif(
    trim(both '"' from current_setting('request.jwt.claim.sub', true)),
    ''
  )::uuid;
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
set search_path = auth, public
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

comment on function auth.uid() is
  'Self-hosted: set request.jwt.claim.sub per transaction from Supabase JWT sub.';
