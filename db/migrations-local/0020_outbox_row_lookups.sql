-- Outbox lookups by row, and a backfill that can run twice.
--
--  * Every write looks up the op waiting for its row by (table_name, row_id),
--    and the only index was on seq, so each lookup read the whole queue. A big
--    first sync made every later write slower.
--  * sync_backfill queued every owned row without checking the queue. A device
--    that stopped between the backfill and adoption queued every row a second
--    time on the next try.
--  * sync_writable_columns read information_schema.columns, a view that checks
--    privileges on every column of every table, on every outbox write. The
--    catalog answers the same question directly.

create index if not exists sync_outbox_row_idx on sync_outbox (table_name, row_id) where dead_at is null;

create or replace function sync_writable_columns(p_table text) returns text[]
language sql
stable
as $$
  select coalesce(array_agg(a.attname::text order by a.attnum), '{}')
    from pg_attribute a
   where a.attrelid = to_regclass(format('public.%I', p_table))
     and a.attnum > 0
     and not a.attisdropped
     and a.attgenerated = ''
     and a.attidentity = '';
$$;

create or replace function sync_backfill(p_account uuid) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
  owned boolean;
  queued integer := 0;
  appended integer;
begin
  for t in select sync_tables_parent_first() loop
    select exists (
      select 1 from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = t and c.column_name = 'user_id'
    ) into owned;
    execute format(
      'insert into sync_outbox (table_name, row_id, op, payload, base_version)
         select %L, r.id, ''insert'', sync_payload(%L, to_jsonb(r)), null from public.%I r
          where r.deleted_at is null and (%s)
            and not exists (select 1 from sync_outbox o where o.table_name = %L and o.row_id = r.id)
          order by r.id',
      t, t, t, case when owned then 'r.user_id = $1' else 'true' end, t)
      using p_account;
    get diagnostics appended = row_count;
    queued := queued + appended;
  end loop;
  return queued;
end;
$$;
