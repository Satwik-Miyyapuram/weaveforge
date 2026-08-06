-- OCI / self-hosted Postgres only. Applied AFTER supabase/migrations/*.
--
-- Row-level security does not apply to the owner of a table. On Supabase that
-- is invisible, because PostgREST switches to `authenticated` before it runs a
-- statement, and `authenticated` owns nothing. A self-hosted deployment
-- connects with `DATABASE_URL`, which the setup guide points at the database
-- owner — so without this file, and without the matching `set local role` in
-- `pg-runner.ts`, every policy in the schema is inert and every user can read
-- every other user's rows.
--
-- Measured before writing it: as the owner, with one user's claim set, a
-- `select count(*) from papers` returned every row in the table including
-- another user's.
--
-- Two halves are needed and neither is sufficient alone:
--   1. the app must run as `authenticated` (pg-runner does this), and
--   2. `authenticated` must have privileges on the tables (this file).

-- Schema visibility. Without `usage` the role cannot name a table at all,
-- which surfaces as "permission denied for schema public" rather than as an
-- empty result.
grant usage on schema public to anon, authenticated, service_role;

-- Table privileges. RLS is what decides *which rows*; a grant decides whether
-- the table can be addressed at all. Every base migration that remembered to
-- grant did so for a subset — 24 of 40 tables — so this covers the rest
-- uniformly rather than leaving the difference to chance.
do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format(
      'grant select, insert, update, delete on public.%I to authenticated',
      t.relname
    );
    -- service_role bypasses RLS; it is for sync jobs and admin paths, and is
    -- never the role a browser request runs as.
    execute format('grant all on public.%I to service_role', t.relname);
  end loop;
end $$;

-- Sequences backing identity columns; an insert needs them.
grant usage, select on all sequences in schema public to authenticated, service_role;

-- Functions the policies themselves call (`can_view_resource`, and friends).
grant execute on all functions in schema public to authenticated, service_role;

-- Tables added by a later migration should not silently be unreachable.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;

-- `anon` deliberately gets nothing beyond schema usage. Nothing in this app is
-- readable without a session; share links go through SECURITY DEFINER RPCs that
-- carry their own checks.

comment on schema public is
  'App schema. Browser requests run as `authenticated` (see pg-runner.ts) so RLS applies; the owner role is for migrations only.';
