-- Local-first: a signed-in desktop works on this database and syncs it.
--
-- Until now the outbox was filled only by adoption's one-off backfill. Every
-- edit made after that stayed on this device, because nothing turned a local
-- write into an op. `sync_record` does: an after-row trigger on each synced
-- table that appends what changed, once the device belongs to an account.
--
-- The rest of this file makes the pieces around it hold up under real data:
--
--  * Generated columns (`vault_pages.body_preview`) are the server's to
--    compute. A payload that carries one is refused by PostgREST, and a pulled
--    row that carries one cannot be inserted here. Both sides now leave them out.
--  * Pulled rows are written with row-level security and foreign keys off. The
--    rows come from the server, which already enforced both; a shared project's
--    rows belong to collaborators this device has no user row for, and the
--    order the feed delivers them in is not the order the keys want.
--  * Adoption re-owns rows as the account, which the local user's own policies
--    refuse. The functions that move rows between owners run as the database
--    owner, which is this device.
--  * A tombstone deletes the local row. Keeping it with `deleted_at` set left it
--    on every screen, because no screen filters on that column.

-- The columns a write may name: everything but what Postgres computes itself.
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

-- A row as the server should receive it: the generated columns taken out.
create or replace function sync_payload(p_table text, p_row jsonb) returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    from jsonb_each(p_row) e
   where e.key = any (sync_writable_columns(p_table));
$$;

create or replace function sync_apply(p_table text, p_row jsonb) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cols text[];
  col_list text;
  assignments text;
begin
  if not exists (select 1 from sync_tables where table_name = p_table) then
    raise exception 'sync_apply: % is not a synced table', p_table;
  end if;

  perform set_config('weaveforge.sync_applying', 'on', true);
  perform set_config('session_replication_role', 'replica', true);

  if p_row ? 'deleted_at' and p_row ->> 'deleted_at' is not null then
    execute format('delete from public.%I where id = $1', p_table) using (p_row ->> 'id')::uuid;
  else
    if p_row ? 'user_id' and p_row ->> 'user_id' is not null then
      insert into auth.users (id) values ((p_row ->> 'user_id')::uuid) on conflict (id) do nothing;
    end if;
    cols := sync_writable_columns(p_table);
    select string_agg(format('%I', c), ', '),
           string_agg(format('%I = excluded.%I', c, c), ', ') filter (where c <> 'id')
      into col_list, assignments
      from unnest(cols) c;
    execute format(
      'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)
         on conflict (id) do update set %s',
      p_table, col_list, col_list, p_table, assignments)
      using p_row;
  end if;

  perform set_config('session_replication_role', 'origin', true);
  perform set_config('weaveforge.sync_applying', 'off', true);
end;
$$;

-- A page of rows at once, so a first download is one round trip per page
-- rather than one per row.
create or replace function sync_apply_many(p_table text, p_rows jsonb) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  n integer := 0;
begin
  for r in select value from jsonb_array_elements(p_rows) loop
    perform sync_apply(p_table, r);
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function sync_claim(p_account uuid, p_local uuid) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
  owner_column text;
  moved integer := 0;
  touched integer;
begin
  -- The account has to exist here before any row can point at it.
  insert into auth.users (id) values (p_account) on conflict (id) do nothing;
  for t in select s.table_name from sync_tables s order by s.table_name loop
    select c.column_name into owner_column
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = t and c.column_name = 'user_id';
    continue when owner_column is null;

    perform set_config('weaveforge.sync_applying', 'on', true);
    execute format('update public.%I set user_id = $1 where user_id = $2', t)
      using p_account, p_local;
    get diagnostics touched = row_count;
    perform set_config('weaveforge.sync_applying', 'off', true);
    moved := moved + touched;
  end loop;
  return moved;
end;
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
  for t in select s.table_name from sync_tables s order by s.table_name loop
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;
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

-- One op per row that has not been sent yet. A second edit before the next
-- push rewrites the waiting op instead of queueing behind it: the server only
-- needs the latest state, and the waiting op's base version is still the one
-- the server holds. A row created and deleted between two pushes never leaves.
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

do $$
declare
  t text;
begin
  -- The device-only test database has no app tables and no registry.
  if to_regclass('public.sync_tables') is null then
    return;
  end if;
  for t in select s.table_name from sync_tables s loop
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;
    execute format('drop trigger if exists sync_record on public.%I', t);
    execute format(
      'create trigger sync_record after insert or update or delete on public.%I
         for each row execute function sync_record()', t);
  end loop;
end;
$$;
