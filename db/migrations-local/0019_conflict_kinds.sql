-- A delete on one side and an edit on the other used to be settled silently:
-- the delete won and the edit was dropped. Now it is a conflict the reader
-- decides, like two edits to one field.
--   edit            both sides edited; `fields` says where they differ
--   deleted_remote  deleted elsewhere, edited here; the row is kept here meanwhile
--   deleted_local   deleted here, edited elsewhere; the delete waits
alter table sync_conflicts add column if not exists kind text not null default 'edit';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sync_conflicts_kind_check') then
    alter table sync_conflicts add constraint sync_conflicts_kind_check
      check (kind in ('edit', 'deleted_remote', 'deleted_local'));
  end if;
end;
$$;

-- The reader agreed to a delete made elsewhere. Remove the row here with its
-- local cascade, and with it whatever this device still owed for the rows that
-- went: the server no longer has them either. Nothing is queued.
create or replace function sync_accept_delete(p_table text, p_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  gone boolean;
begin
  if not exists (select 1 from sync_tables where table_name = p_table) then
    raise exception 'sync_accept_delete: % is not a synced table', p_table;
  end if;
  -- Origin role so FK cascades run; sync_applying so they are not recorded.
  perform set_config('weaveforge.sync_applying', 'on', true);
  perform set_config('session_replication_role', 'origin', true);
  execute format('delete from public.%I where id = $1', p_table) using p_id;
  delete from sync_outbox where table_name = p_table and row_id = p_id;
  update sync_conflicts set resolved_at = now()
   where table_name = p_table and row_id = p_id and resolved_at is null;
  for o in
    select distinct x.table_name, x.row_id from sync_outbox x
      join sync_tables s on s.table_name = x.table_name
     where x.op <> 'delete'
  loop
    execute format('select not exists (select 1 from public.%I where id = $1)', o.table_name)
      into gone using o.row_id;
    if gone then
      delete from sync_outbox where table_name = o.table_name and row_id = o.row_id;
      update sync_conflicts set resolved_at = now()
       where table_name = o.table_name and row_id = o.row_id and resolved_at is null;
    end if;
  end loop;
  perform set_config('weaveforge.sync_applying', 'off', true);
end;
$$;

do $$
begin
  revoke all on function sync_accept_delete(text, uuid) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function sync_accept_delete(text, uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function sync_accept_delete(text, uuid) to authenticated;
  end if;
end;
$$;
