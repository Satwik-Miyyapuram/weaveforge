-- Migration: queued payloads can no longer carry columns the server refuses or owners it rejects.

-- Every append path, not only the backfill, drops generated columns.
create or replace function sync_outbox_clean() returns trigger
language plpgsql
as $$
begin
  if new.payload is not null and new.payload <> '{}'::jsonb
     and coalesce(array_length(sync_writable_columns(new.table_name), 1), 0) > 0 then
    new.payload := sync_payload(new.table_name, new.payload);
  end if;
  return new;
end;
$$;

drop trigger if exists sync_outbox_clean on sync_outbox;
create trigger sync_outbox_clean before insert or update of payload on sync_outbox
  for each row execute function sync_outbox_clean();

-- Claiming rows must also re-own the payloads already queued for them.
create or replace function sync_claim(p_account uuid, p_local uuid) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  moved integer := 0;
  touched integer;
begin
  insert into auth.users (id) values (p_account) on conflict (id) do nothing;
  for r in
    select c.table_name, c.column_name
      from sync_tables s
      join information_schema.columns c
        on c.table_schema = 'public' and c.table_name = s.table_name
     where c.column_name in ('user_id', 'reviewer_id', 'author_id', 'owner_id')
     order by c.table_name, c.column_name
  loop
    perform set_config('weaveforge.sync_applying', 'on', true);
    execute format('update public.%I set %I = $1 where %I = $2', r.table_name, r.column_name, r.column_name)
      using p_account, p_local;
    get diagnostics touched = row_count;
    perform set_config('weaveforge.sync_applying', 'off', true);
    moved := moved + touched;
    update sync_outbox o
       set payload = jsonb_set(o.payload, array[r.column_name], to_jsonb(p_account::text))
     where o.table_name = r.table_name and o.payload ->> r.column_name = p_local::text;
  end loop;
  return moved;
end;
$$;

revoke all on function sync_claim(uuid, uuid) from public;

-- Repair ops already dead-lettered by the bugs above, then give them a fresh run.
do $$
declare
  r record;
begin
  -- An adopted insert the server holds under another id never drains; the server's copy wins.
  delete from sync_outbox
   where dead_at is not null and op = 'insert' and last_error = 'A newer version on the server.';

  -- Owners still on the local placeholder take the owner the row now has.
  for r in
    select c.table_name, c.column_name
      from information_schema.columns c
     where to_regclass('public.sync_tables') is not null
       and c.table_schema = 'public'
       and c.table_name in (select o.table_name from sync_outbox o where o.dead_at is not null)
       and c.column_name in ('user_id', 'reviewer_id', 'author_id', 'owner_id')
  loop
    execute format(
      'update sync_outbox o set payload = jsonb_set(o.payload, array[%L], to_jsonb(t.%I::text))
         from public.%I t
        where o.table_name = %L and o.dead_at is not null and t.id::text = o.row_id::text
          and o.payload ->> %L = ''00000000-0000-4000-8000-000000000001''
          and t.%I is not null and t.%I::text <> ''00000000-0000-4000-8000-000000000001''',
      r.column_name, r.column_name, r.table_name, r.table_name, r.column_name, r.column_name, r.column_name);
  end loop;

  -- The update fires sync_outbox_clean, which strips generated columns.
  update sync_outbox set payload = payload, dead_at = null, attempts = 0, last_error = null
   where dead_at is not null;
end;
$$;
