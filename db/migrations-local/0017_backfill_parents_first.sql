-- Send parents before children, and find the rows that were never sent.
--
-- The backfill walked sync_tables by name, so papers (and every other child of
-- a project) were queued before projects. The server refused each child for its
-- missing parent, the pump read that as "the server already holds this under
-- another id" and dropped it. The rows stayed on the device; the server never
-- got them. This queues tables parent first, and records whether this device
-- has checked the server for rows it still holds and the server does not.

-- Sync tables, each after every sync table it references.
-- plpgsql, not sql: a device-only database has no sync_tables, and a sql body
-- is checked when it is created.
create or replace function sync_tables_parent_first() returns setof text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
  with recursive t as (
    select s.table_name::text as table_name, to_regclass(format('public.%I', s.table_name)) as rel
      from sync_tables s
     where to_regclass(format('public.%I', s.table_name)) is not null
  ),
  edges as (
    select distinct c.conrelid as child, c.confrelid as parent
      from pg_constraint c
     where c.contype = 'f'
       and c.conrelid <> c.confrelid
       and c.conrelid in (select rel from t)
       and c.confrelid in (select rel from t)
  ),
  depth(rel, d) as (
    select rel, 0 from t
    union
    select e.child, depth.d + 1 from depth join edges e on e.parent = depth.rel where depth.d < 32
  )
  select t.table_name
    from t join depth on depth.rel = t.rel
   group by t.table_name
   order by max(depth.d), t.table_name;
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

-- Live rows of one table this device holds for the account and has no op for:
-- the ones to ask the server about.
create or replace function sync_unsent_candidates(p_table text, p_account uuid) returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  owned boolean;
begin
  if p_table not in (select table_name from sync_tables) or to_regclass(format('public.%I', p_table)) is null then
    return;
  end if;
  select exists (
    select 1 from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = p_table and c.column_name = 'user_id'
  ) into owned;
  return query execute format(
    'select r.id from public.%I r
      where r.deleted_at is null and (%s)
        and not exists (select 1 from sync_outbox o where o.table_name = %L and o.row_id = r.id)
      order by r.id',
    p_table, case when owned then 'r.user_id = $1' else 'true' end, p_table)
    using p_account;
end;
$$;

-- Queue inserts for rows the server turned out not to hold.
create or replace function sync_resend(p_table text, p_ids uuid[]) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  appended integer;
begin
  if p_table not in (select table_name from sync_tables) or to_regclass(format('public.%I', p_table)) is null then
    return 0;
  end if;
  execute format(
    'insert into sync_outbox (table_name, row_id, op, payload, base_version)
       select %L, r.id, ''insert'', sync_payload(%L, to_jsonb(r)), null from public.%I r
        where r.id = any($1) and r.deleted_at is null
          and not exists (select 1 from sync_outbox o where o.table_name = %L and o.row_id = r.id)
        order by r.id',
    p_table, p_table, p_table, p_table)
    using p_ids;
  get diagnostics appended = row_count;
  return appended;
end;
$$;

-- Null until this device has compared what it holds with what the server holds.
alter table sync_state add column if not exists resend_checked_at timestamptz;

do $$
declare
  f text;
begin
  foreach f in array array[
    'sync_tables_parent_first()', 'sync_backfill(uuid)', 'sync_unsent_candidates(text, uuid)',
    'sync_resend(text, uuid[])'
  ] loop
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

-- Children dead-lettered for a parent that had not gone up yet: the parent goes first now.
update sync_outbox set dead_at = null, attempts = 0, last_error = null
 where dead_at is not null and last_error ilike '%foreign key%';
