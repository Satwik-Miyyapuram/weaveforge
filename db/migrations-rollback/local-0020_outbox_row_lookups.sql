-- Undo local 0020 on a device database — drop the outbox row index and restore
-- the previous sync_writable_columns and sync_backfill.
--
-- Lossless: no data changes. Run it against the device database, not the server.
-- After it, a second backfill can queue rows twice again (39-08), and outbox
-- writes go back to scanning the queue (39-07).
--
-- Safe to run more than once. The desktop app records 0020 in
-- weaveforge_migrations, so it does not re-apply 0020 on its own; delete that
-- ledger row too if you want it back on next start.

drop index if exists sync_outbox_row_idx;

create or replace function sync_writable_columns(p_table text) returns text[]
language sql
stable
as $$
  select coalesce(array_agg(c.column_name::text order by c.ordinal_position), '{}')
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = p_table
     and c.is_generated = 'NEVER'
     and c.is_identity = 'NO';
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
          order by r.id',
      t, t, t, case when owned then 'r.user_id = $1' else 'true' end)
      using p_account;
    get diagnostics appended = row_count;
    queued := queued + appended;
  end loop;
  return queued;
end;
$$;
