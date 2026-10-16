-- Migration: the change feed is one stream, ordered by server_seq.
--
-- `sync_changes` walked the sync tables one at a time, each taking what was
-- left of the limit. The client advances its watermark to the highest
-- server_seq it received, so once the first table filled the page, every
-- lower-numbered change in a later table was behind the watermark and never
-- sent. One `union all` over every table, ordered as a whole, cannot skip.

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
  if cardinality(parts) = 0 then
    return;
  end if;
  return query execute array_to_string(parts, ' union all ')
    || ' order by server_seq, table_name, row_id limit $2'
    using p_since, greatest(least(coalesce(p_limit, 500), 2000), 1);
end;
$$;

grant execute on function sync_changes(bigint, integer) to authenticated;
