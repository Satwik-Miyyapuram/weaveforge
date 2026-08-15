-- OCI / self-hosted Postgres only. NOT applied by `supabase db push`.
-- Run after supabase/migrations/0117_ensure_user_provisioned.sql.
--
-- Supabase Auth issues the tokens; this database only mirrors enough of
-- `auth.users` to satisfy the foreign keys and `auth.uid()`. 0025 left the
-- mirroring to "a webhook or batch job" that was never built, so accounts
-- created after the cutover existed in Auth and nowhere else: the first write
-- of a new session -- accepting the privacy disclaimer -- died on
-- `user_settings_user_id_fkey`, reported to the user as a bare error object.
--
-- Mirror on demand instead. The caller's JWT is verified before any statement
-- runs and carries everything the stub stores, so the row can be materialised
-- from it the first time the user asks, with no replication lag and no second
-- service to keep alive.

-- `complete_org_setup()` and `handle_new_user()` both read this column. It is
-- absent from the stub, so those functions failed at runtime on this database.
alter table auth.users add column if not exists raw_user_meta_data jsonb;

-- Overrides the no-op in 0117. Security definer: `authenticated` has no rights
-- on auth.users (0025 revokes them), and must not -- the only row this creates
-- is the caller's own, keyed by auth.uid() with no way to name anyone else.
create or replace function public.ensure_auth_user_row()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid    uuid := auth.uid();
  claims jsonb := auth.jwt();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into auth.users (id, email, raw_user_meta_data)
  values (
    uid,
    coalesce(claims->>'email', claims->'user_metadata'->>'email'),
    coalesce(claims->'user_metadata', '{}'::jsonb)
  )
  on conflict (id) do update
    -- A changed email (or a Google profile rename) should not be stuck at
    -- whatever it was on first sign-in, but never overwrite a known value with
    -- a null from a token that happens to omit the claim.
    set email = coalesce(excluded.email, auth.users.email),
        raw_user_meta_data = coalesce(excluded.raw_user_meta_data, auth.users.raw_user_meta_data);
end;
$$;

comment on function public.ensure_auth_user_row() is
  'Self-hosted: mirrors the calling user''s auth.users row from their verified JWT.';

revoke all on function public.ensure_auth_user_row() from public;
