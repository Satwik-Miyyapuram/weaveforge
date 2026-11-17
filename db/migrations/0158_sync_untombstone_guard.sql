-- Migration: a stale copy cannot bring a deleted row back (S6).
--
-- 0134 cleared a row's tombstone on every insert, so a device that replayed an
-- old insert from its outbox (created before another device deleted the row)
-- resurrected the row. That is data loss in the other direction: the delete was
-- the newer intent.
--
-- The guard now runs BEFORE INSERT. If the row has a tombstone:
--  * created after the delete  -> a genuine re-create; the tombstone goes and
--    the insert proceeds.
--  * created before the delete, or with no known created_at -> a stale copy;
--    the insert is skipped and the tombstone stays, so the delete wins.
--
-- The insert is skipped silently (returns null), so the pusher sees the request
-- succeed and the server keeps the delete. The trigger names are unchanged.

create or replace function sync_untombstone() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted timestamptz;
  created timestamptz := nullif(to_jsonb(new) ->> 'created_at', '')::timestamptz;
begin
  select d.deleted_at into deleted
    from sync_tombstones d
   where d.table_name = tg_table_name and d.row_id = new.id;
  if not found then
    return new;
  end if;
  if created is not null and created > deleted then
    delete from sync_tombstones where table_name = tg_table_name and row_id = new.id;
    return new;
  end if;
  -- Stale copy of a deleted row: keep the delete.
  return null;
end;
$$;

revoke all on function sync_untombstone() from public, anon;

do $$
declare
  t text;
begin
  for t in select s.table_name from sync_tables s order by s.table_name loop
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;
    execute format('drop trigger if exists %I on public.%I', t || '_sync_untombstone', t);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function sync_untombstone()',
      t || '_sync_untombstone', t);
  end loop;
end;
$$;
