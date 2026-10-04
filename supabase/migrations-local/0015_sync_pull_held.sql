-- Pulled changes that would not apply. Parked here so one bad row cannot stall
-- the watermark; each pull retries them until a write or a newer change lands.
create table if not exists sync_pull_held (
  table_name text not null,
  row_id     text not null,
  server_seq bigint not null,
  change     jsonb not null,
  error      text not null,
  attempts   int not null default 1,
  first_at   timestamptz not null default now(),
  last_at    timestamptz not null default now(),
  primary key (table_name, row_id)
);

-- Rows that block each other on a unique key (two titles swapped) cannot land
-- one at a time. Clear them all, then write them, in one call. Replica mode
-- keeps children from cascading; every column is rewritten anyway.
create or replace function sync_apply_group(p_table text, p_rows jsonb) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  n integer := 0;
begin
  if not exists (select 1 from sync_tables where table_name = p_table) then
    raise exception 'sync_apply_group: % is not a synced table', p_table;
  end if;
  perform set_config('weaveforge.sync_applying', 'on', true);
  perform set_config('session_replication_role', 'replica', true);
  execute format('delete from public.%I where id = any($1)', p_table)
    using array(select (value ->> 'id')::uuid from jsonb_array_elements(p_rows));
  for r in select value from jsonb_array_elements(p_rows) loop
    perform sync_apply(p_table, r);
    n := n + 1;
  end loop;
  return n;
end;
$$;
