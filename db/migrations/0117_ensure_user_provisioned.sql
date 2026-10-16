-- Migration: provision the calling user's own rows on demand.
--
-- Every table keys off `auth.users(id)` and `profiles(user_id)`, and both are
-- filled by the `on_auth_user_created` trigger — a trigger on `auth.users`,
-- which only exists where Supabase Auth's own tables live. After the data moved
-- to a self-hosted Postgres, Auth stayed on Supabase and the trigger stayed
-- with it, so a *new* account is created in one database and every write lands
-- in the other. The first write a new user makes is the privacy disclaimer, and
-- it failed with a foreign key violation on `user_settings_user_id_fkey`:
-- signing up worked, and then nothing else did.
--
-- The fix is a pull instead of a push. Rather than replicating Auth into the
-- data database with a webhook (a second moving part, and a window where the
-- user is signed in but not yet copied), the app asks for its own rows at
-- startup, and the database materialises them from the caller's verified JWT.
--
-- Safety: this provisions `auth.uid()` and nothing else. There is no parameter
-- to point it at another user, so `authenticated` cannot use it to create or
-- alter anyone but themselves. It is idempotent, so a duplicate call from a
-- second tab is a no-op rather than a conflict.
--
-- On Supabase Cloud `ensure_auth_user_row()` is a no-op: the trigger already
-- did this work, so `ensure_user_provisioned()` finds both rows present and
-- returns. The self-hosted deployment overrides that one function (see
-- migrations-self-hosted-postgres/0029_self_host_user_provisioning.sql).

-- Where Supabase Auth owns `auth.users`, the row is already there by the time
-- any JWT exists. Split out as its own function purely so the self-hosted
-- database can replace this half without duplicating the profile logic below.
create or replace function public.ensure_auth_user_row()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  return;
end;
$$;

comment on function public.ensure_auth_user_row() is
  'No-op where Supabase Auth owns auth.users; overridden on self-hosted Postgres.';

create or replace function public.ensure_user_provisioned()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  claims jsonb := auth.jwt();
  uemail text;
  uname  text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  perform public.ensure_auth_user_row();

  -- Nothing to do for the overwhelmingly common case (every boot after the
  -- first), so spend one index lookup rather than an upsert's write path.
  if exists (select 1 from profiles where user_id = uid) then
    return;
  end if;

  -- The JWT is the authority on the caller's identity here and it is verified
  -- before the statement runs, so this needs no read of auth.users -- which on
  -- a self-hosted deployment may hold only the columns the stub defines.
  uemail := coalesce(claims->>'email', claims->'user_metadata'->>'email');
  uname := coalesce(
    claims->'user_metadata'->>'full_name',
    claims->'user_metadata'->>'name',
    uemail
  );

  -- Same shape handle_new_user() produces, so a user provisioned here and one
  -- provisioned by the trigger are indistinguishable to the org setup flow.
  insert into profiles (user_id, email, full_name, role, org_setup_complete)
  values (uid, uemail, uname, 'masters', false)
  on conflict (user_id) do nothing;
end;
$$;

comment on function public.ensure_user_provisioned() is
  'Idempotently creates the calling user''s auth.users/profiles rows from their JWT.';

revoke all on function public.ensure_auth_user_row() from public;
revoke all on function public.ensure_user_provisioned() from public;
grant execute on function public.ensure_user_provisioned() to authenticated;
