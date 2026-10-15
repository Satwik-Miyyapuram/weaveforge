-- A row made here that never reached the server can clash on a natural key with
-- the server's copy (same paper added on two devices). Its children then wait on
-- a parent the server refuses (23503) forever. Fold the local row into the
-- server's: children point at the server id, then the server row lands.

-- The other row a unique index says `p_row` collides with. Works for expression
-- and partial indexes too: the index's own key and predicate are evaluated.
create or replace function sync_twin_of(p_table text, p_index text, p_row jsonb) returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  x record;
  keys text;
  pred text;
  twin uuid;
begin
  select i.indexrelid, i.indrelid, i.indkey, i.indnkeyatts, i.indpred into x
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_class t on t.oid = i.indrelid
   where i.indisunique and c.relname = p_index and t.relname = p_table
     and t.relnamespace = 'public'::regnamespace;
  if not found then
    return null;
  end if;
  if exists (select 1 from pg_attribute a
              where a.attrelid = x.indrelid and a.attname = 'id' and a.attnum = any(x.indkey)) then
    return null;
  end if;
  select string_agg(pg_get_indexdef(x.indexrelid, k, true), ', ' order by k) into keys
    from generate_series(1, x.indnkeyatts) k;
  pred := coalesce(pg_get_expr(x.indpred, x.indrelid, true), 'true');
  execute format(
    'select t.id from public.%1$I t, jsonb_populate_record(null::public.%1$I, $1) r
      where t.id <> r.id
        and (select row(%2$s) from (select t.*) s) is not distinct from (select row(%2$s) from (select r.*) s)
        and (select %3$s from (select t.*) s)
      limit 1', p_table, keys, pred)
    into twin using p_row;
  return twin;
end;
$$;

-- Returns the child rows that clashed with a child the server row already has
-- ([{table, row_id, local}]): each was folded into that child, and `local` is
-- what this device had, for the caller to open as a conflict.
drop function if exists sync_merge_twin(text, uuid, jsonb);
create function sync_merge_twin(p_table text, p_twin uuid, p_row jsonb) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  c record;
  target uuid := (p_row ->> 'id')::uuid;
  folded jsonb := '[]'::jsonb;
  moved jsonb;
  owed jsonb;
  cname text;
  other uuid;
  other_row jsonb;
begin
  if not exists (select 1 from sync_tables where table_name = p_table) then
    raise exception 'sync_merge_twin: % is not a synced table', p_table;
  end if;
  perform set_config('weaveforge.sync_applying', 'on', true);
  perform set_config('session_replication_role', 'replica', true);
  for r in
    select ch.relname as child, a.attname as col
      from pg_constraint k
      join pg_class p on p.oid = k.confrelid
      join pg_class ch on ch.oid = k.conrelid
      join pg_attribute a on a.attrelid = ch.oid and a.attnum = k.conkey[1]
     where k.contype = 'f' and array_length(k.conkey, 1) = 1
       and p.relname = p_table and p.relnamespace = 'public'::regnamespace
       and ch.relnamespace = 'public'::regnamespace
  loop
    for c in execute format('select to_jsonb(x) as row from public.%I x where %I = $1', r.child, r.col)
      using p_twin
    loop
      moved := jsonb_set(c.row, array[r.col::text], to_jsonb(target::text));
      begin
        execute format('update public.%I set %I = $1 where id = $2', r.child, r.col)
          using target, (c.row ->> 'id')::uuid;
      exception when unique_violation then
        -- The server row already has this child (same paper on the same list).
        get stacked diagnostics cname = constraint_name;
        other := sync_twin_of(r.child, cname, moved);
        if other is null or not exists (select 1 from sync_tables where table_name = r.child) then
          raise;
        end if;
        select o.payload into owed from sync_outbox o
         where o.table_name = r.child and o.row_id = (c.row ->> 'id')::uuid and o.op <> 'delete'
         order by o.seq desc limit 1;
        owed := coalesce(owed, sync_payload(r.child, c.row));
        owed := jsonb_set(jsonb_set(owed, array[r.col::text], to_jsonb(target::text)), '{id}', to_jsonb(other::text));
        execute format('select to_jsonb(x) from public.%I x where id = $1', r.child) into other_row using other;
        folded := folded
          || sync_merge_twin(r.child, (c.row ->> 'id')::uuid, other_row)
          || jsonb_build_array(jsonb_build_object('table', r.child, 'row_id', other, 'local', owed));
        -- The nested merge ends by switching these off.
        perform set_config('weaveforge.sync_applying', 'on', true);
        perform set_config('session_replication_role', 'replica', true);
      end;
    end loop;
    update sync_outbox o
       set payload = jsonb_set(o.payload, array[r.col::text], to_jsonb(target::text))
     where o.table_name = r.child and o.payload ->> r.col = p_twin::text;
  end loop;
  delete from sync_outbox where table_name = p_table and row_id = p_twin;
  execute format('delete from public.%I where id = $1', p_table) using p_twin;
  perform sync_apply(p_table, p_row);
  return folded;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['sync_twin_of(text, text, jsonb)', 'sync_merge_twin(text, uuid, jsonb)'] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end;
$$;

-- Devices adopted before 0012 kept the local placeholder in owner_id; the server
-- has no such user, so every push of those rows failed 23503. Claim again.
do $$
declare
  account uuid;
begin
  select account_id into account from sync_state limit 1;
  if account is not null then
    perform sync_claim(account, '00000000-0000-4000-8000-000000000001');
    update sync_outbox set dead_at = null, attempts = 0, last_error = null
     where dead_at is not null and last_error ilike '%foreign key%';
  end if;
end;
$$;
