-- Migration: write a row the server sent, exactly as the server sent it.
--
-- Applying a pulled row is the one write that must not be treated as a local
-- edit: its watermark and version are the server's, and re-stamping them would
-- make the device re-send the row as its own work. `sync_apply` sets the
-- transaction-local flag that `sync_stamp` steps aside for, then upserts.
--
-- The row is expected whole: the feed sends `to_jsonb(r)`, and a partial row
-- would write nulls over columns the server never meant to change.
--
-- Dynamic SQL, deliberately: the feed spans tables of different shapes. It is
-- bounded by the `sync_tables` registry — a table name that is not in it is
-- refused rather than interpolated — so this cannot be pointed at anything the
-- sync design does not already cover.
create or replace function sync_apply(p_table text, p_row jsonb) returns void
language plpgsql
as $$
declare
  assignments text;
begin
  if not exists (select 1 from sync_tables where table_name = p_table) then
    raise exception 'sync_apply: % is not a synced table', p_table;
  end if;

  select string_agg(format('%I = excluded.%I', column_name, column_name), ', ')
    into assignments
    from information_schema.columns
   where table_schema = 'public' and table_name = p_table and column_name <> 'id';

  perform set_config('weaveforge.sync_applying', 'on', true);
  execute format(
    'insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)
       on conflict (id) do update set %s',
    p_table, p_table, assignments)
    using p_row;
  perform set_config('weaveforge.sync_applying', 'off', true);
end;
$$;
