-- Migration: shared items as snapshots.
--
-- A shared item (a note, canvas, feed or annotation set) is stored in shared_docs
-- as a JSON snapshot of its row: state is {type, row}, the same shape as a feed.
-- 'item' is the kind for those snapshots. Nothing here changes existing rows.
--
-- profiles.exported_097_at is the server-side marker that a user's local data was
-- exported in 0.9.7. Only a verified export sets it, and only through
-- mark_exported_097(). Null means not exported yet.
--
-- Trust model: the marker is trust-based, not proof. A client calls
-- mark_exported_097() only after a verified report of its export. The server
-- cannot check the export itself. Migration 0165 therefore also requires
-- profiles.updated_at > exported_097_at before it treats the marker as valid.

alter table shared_docs drop constraint if exists shared_docs_kind_check;
alter table shared_docs
  add constraint shared_docs_kind_check
  check (kind in ('annotations', 'canvas', 'feed', 'item', 'note'));

alter table profiles
  add column if not exists exported_097_at timestamptz null;

-- Signed-in users may hold a table-level UPDATE grant on profiles, and a
-- column-level revoke cannot narrow that. So the marker is also guarded by a
-- trigger: any change to it must come from mark_exported_097() (which sets the
-- transaction-local flag below). Admin RLS writes go through the same trigger.
revoke update (exported_097_at) on profiles from authenticated, anon;

create or replace function profiles_guard_export_marker()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'insert' or new.exported_097_at is distinct from old.exported_097_at)
     and coalesce(current_setting('weaveforge.export_marker', true), '') <> 'on' then
    raise exception 'exported_097_at is set only by mark_exported_097()';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_export_marker on profiles;
create trigger profiles_guard_export_marker
  before insert or update on profiles
  for each row execute function profiles_guard_export_marker();

-- Stamps the caller's own profile and returns the stamp. Idempotent per call.
-- Trust-based: call only after the export report has verified locally (see the
-- header). Raises when the signed-in user has no profiles row.
create or replace function mark_exported_097()
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  stamped timestamptz;
  n integer;
begin
  if auth.uid() is null then
    raise exception 'mark_exported_097 needs a signed-in user';
  end if;
  perform set_config('weaveforge.export_marker', 'on', true);
  update profiles
     set exported_097_at = now()
   where user_id = auth.uid()
  returning exported_097_at into stamped;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'no profiles row for the signed-in user';
  end if;
  return stamped;
end;
$$;

revoke all on function mark_exported_097() from public, anon;
grant execute on function mark_exported_097() to authenticated;

notify pgrst, 'reload schema';
