-- Migration: queue paper_tags, and keep a delete-then-reinsert as one update.
--
-- Re-tagging a paper deletes its links and inserts them again under the same
-- id. With the delete still queued, the insert used to keep op 'delete' and the
-- link vanished on the server; it now becomes an update of the server's row.
create or replace function sync_record() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t text := tg_table_name;
  v_row uuid;
  waiting sync_outbox%rowtype;
  next_payload jsonb;
begin
  if coalesce(current_setting('weaveforge.sync_applying', true), '') = 'on' then
    return null;
  end if;
  if not exists (select 1 from sync_state where account_id is not null) then
    return null;
  end if;

  v_row := case when tg_op = 'DELETE' then old.id else new.id end;
  next_payload := case when tg_op = 'DELETE' then '{}'::jsonb else sync_payload(t, to_jsonb(new)) end;

  select * into waiting
    from sync_outbox o
   where o.table_name = t and o.row_id = v_row and o.dead_at is null and o.attempts = 0
   order by o.seq desc
   limit 1;

  if found then
    if tg_op = 'DELETE' and waiting.op = 'insert' then
      delete from sync_outbox o where o.table_name = t and o.row_id = v_row and o.dead_at is null;
    elsif tg_op = 'DELETE' then
      update sync_outbox set op = 'delete', payload = '{}'::jsonb where seq = waiting.seq;
    elsif tg_op = 'INSERT' and waiting.op = 'delete' then
      update sync_outbox set op = 'update', payload = next_payload where seq = waiting.seq;
    else
      update sync_outbox set payload = next_payload where seq = waiting.seq;
    end if;
    return null;
  end if;

  insert into sync_outbox (table_name, row_id, op, payload, base_version, base_payload)
  values (
    t,
    v_row,
    lower(tg_op),
    next_payload,
    case when tg_op = 'INSERT' then null else old.row_version end,
    case when tg_op = 'UPDATE' then sync_payload(t, to_jsonb(old)) else null end
  );
  return null;
end;
$$;

revoke all on function sync_record() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function sync_record() from anon;
  end if;
  -- The device-only test database has no app tables.
  if to_regclass('public.paper_tags') is not null then
    drop trigger if exists sync_record on public.paper_tags;
    create trigger sync_record after insert or update or delete on public.paper_tags
      for each row execute function sync_record();
  end if;
end;
$$;
