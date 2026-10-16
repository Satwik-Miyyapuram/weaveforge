-- Migration: the change feed carries deletes, and every row is in it.
--
-- Two gaps kept a desktop's local copy from matching the server:
--
--  * A row deleted on the web simply vanished. The feed reads live rows, so a
--    device that already had the row never heard it was gone. Deletes now
--    leave a tombstone — table, id, sequence number — that the feed sends like
--    any other change; the device deletes its copy when it arrives.
--  * Rows written before 0118 have `server_seq = 0`, and the feed only sends
--    rows past the device's watermark, which starts at 0. Those rows never
--    reached a device. They now get a real sequence number, so a device that
--    starts from zero downloads everything through the same feed.

create table if not exists sync_tombstones (
  table_name text not null,
  row_id uuid not null,
  -- The deleted row's owner, for who may read the tombstone. Null when the row
  -- has no owner column and its parent was already gone.
  user_id uuid,
  server_seq bigint not null default nextval('sync_seq'),
  deleted_at timestamptz not null default now(),
  primary key (table_name, row_id)
);

create index if not exists sync_tombstones_server_seq_idx on sync_tombstones (server_seq);

alter table sync_tombstones enable row level security;
drop policy if exists sync_tombstones_read on sync_tombstones;
-- An ownerless tombstone reveals a random id and nothing else.
create policy sync_tombstones_read on sync_tombstones for select to authenticated
  using (user_id is null or can_access(user_id));
grant select on sync_tombstones to authenticated;

create or replace function sync_tombstone() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid := (to_jsonb(old) ->> 'user_id')::uuid;
begin
  if owner is null and tg_table_name = 'reading_list_items' then
    select l.user_id into owner from reading_lists l where l.id = (to_jsonb(old) ->> 'list_id')::uuid;
  end if;
  insert into sync_tombstones (table_name, row_id, user_id)
  values (tg_table_name, old.id, owner)
  on conflict (table_name, row_id) do update
    set user_id = excluded.user_id,
        server_seq = nextval('sync_seq'),
        deleted_at = now();
  return null;
end;
$$;

revoke all on function sync_tombstone() from public, anon;

-- A row that comes back under the same id is live again: its tombstone goes.
create or replace function sync_untombstone() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from sync_tombstones where table_name = tg_table_name and row_id = new.id;
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
    execute format('drop trigger if exists %I on public.%I', t || '_sync_tombstone', t);
    execute format(
      'create trigger %I after delete on public.%I for each row execute function sync_tombstone()',
      t || '_sync_tombstone', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sync_untombstone', t);
    execute format(
      'create trigger %I after insert on public.%I for each row execute function sync_untombstone()',
      t || '_sync_untombstone', t);

    -- Rows from before the feed existed. Triggers off, so `updated_at` and
    -- `row_version` stay as they are: only the sequence number is new.
    perform set_config('session_replication_role', 'replica', true);
    execute format(
      'update public.%I set server_seq = nextval(''sync_seq'') where server_seq is null or server_seq = 0', t);
    perform set_config('session_replication_role', 'origin', true);
  end loop;
end;
$$;

create or replace function sync_changes(p_since bigint default 0, p_limit integer default 500)
returns table (table_name text, row_id uuid, server_seq bigint, deleted_at timestamptz, row_version integer, row_data jsonb)
language plpgsql
security invoker
set search_path = public
as $$
declare
  t text;
  parts text[] := '{}';
begin
  for t in select s.table_name from sync_tables s order by s.table_name loop
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;
    parts := parts || format(
      '(select %L::text as table_name, r.id as row_id, r.server_seq, r.deleted_at, r.row_version, to_jsonb(r) as row_data
          from public.%I r
         where r.server_seq > $1
         order by r.server_seq
         limit $2)', t, t);
  end loop;
  parts := parts || '(select d.table_name, d.row_id, d.server_seq, d.deleted_at, 0 as row_version,
                             jsonb_build_object(''id'', d.row_id, ''deleted_at'', d.deleted_at) as row_data
                        from sync_tombstones d
                       where d.server_seq > $1
                       order by d.server_seq
                       limit $2)'::text;
  return query execute array_to_string(parts, ' union all ')
    || ' order by server_seq, table_name, row_id limit $2'
    using p_since, greatest(least(coalesce(p_limit, 500), 2000), 1);
end;
$$;

grant execute on function sync_changes(bigint, integer) to authenticated;
