-- Migration: record the version the server gave an accepted write.
--
-- Local edits bump `row_version` once each, but coalesced edits reach the
-- server as one write and one bump. Without this the local version runs ahead,
-- the next op guards on a version the server never had, and every later edit
-- to that row reads as a conflict.
create or replace function sync_ack(p_table text, p_id text, p_version integer) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from sync_tables where table_name = p_table) then
    raise exception 'sync_ack: % is not a synced table', p_table;
  end if;
  perform set_config('weaveforge.sync_applying', 'on', true);
  perform set_config('session_replication_role', 'replica', true);
  execute format('update public.%I set row_version = $1 where id::text = $2', p_table)
    using p_version, p_id;
  perform set_config('session_replication_role', 'origin', true);
  perform set_config('weaveforge.sync_applying', 'off', true);
end;
$$;

-- Same grants as the other sync definers in 0008: `authenticated` only, never `anon`.
revoke all on function sync_ack(text, text, integer) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function sync_ack(text, text, integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function sync_ack(text, text, integer) to authenticated;
  end if;
end;
$$;
