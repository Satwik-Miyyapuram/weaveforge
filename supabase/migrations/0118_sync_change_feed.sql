-- Migration: the server side of offline sync — a watermark, tombstones, a base
-- version, and a change feed that answers only what the caller may read.
--
-- Nothing here changes what the app does today. It is the contract a client
-- that has been offline needs in order to ask "what changed since I last
-- looked?" and get an answer that is complete, ordered, and free of rows it
-- must not see.
--
-- Four pieces, and each exists because the naive alternative loses data:
--
-- 1. `server_seq` from one database sequence, assigned by trigger. Not
--    `updated_at`: a device whose clock is minutes out — routine after a
--    suspend — would otherwise win or lose everything. Ordering is the
--    server's, always.
-- 2. `deleted_at`, so a delete is a row rather than an absence. To a pull-based
--    client a hard-deleted row is indistinguishable from one it has not synced
--    yet, which is the single most common way sync resurrects deleted data.
-- 3. `row_version`, so a client can say "I am changing this, based on version
--    N" and the server can tell a concurrent edit from a stale overwrite
--    instead of blindly accepting the last writer.
-- 4. `sync_changes()`, which reads the tables as the caller. It is
--    security-invoker, so every existing policy applies to the feed exactly as
--    it applies to a direct select, with no second copy of the rules to keep in
--    step.
--
-- Which tables take part is data, not code: `sync_tables` is a registry, and
-- adding a table to sync means inserting a row and running `sync_prepare()`.

create sequence if not exists sync_seq as bigint;

-- The tables that take part, and nothing else. A registry rather than a list
-- inside a function: the change feed, the trigger installer and any future
-- backfill all have to agree on this set, and agreement is easiest when there
-- is one copy of it.
create table if not exists sync_tables (
  table_name text primary key,
  added_at timestamptz not null default now()
);
alter table sync_tables enable row level security;
-- Readable by anyone signed in: it names tables, not rows, and a client needs
-- it to know what to ask for. Writable only by the migration's owner.
drop policy if exists sync_tables_read on sync_tables;
create policy sync_tables_read on sync_tables for select to authenticated using (true);
grant select on sync_tables to authenticated;

-- Only tables whose rows carry a uuid `id`: the feed identifies a row by one
-- column, and a join table keyed by a pair has nothing to put there. Those
-- follow their parent row instead, which is a phase 4 decision, not this one.
insert into sync_tables (table_name) values
  ('projects'), ('papers'), ('tags'),
  ('paper_field_defs'), ('paper_field_values'), ('paper_relations'),
  ('reading_lists'), ('reading_list_items'),
  ('log_entries'), ('milestones'), ('experiments'),
  ('report_sections'), ('reader_annotations'), ('annotation_pins'),
  ('library_pins'), ('vault_pages')
on conflict (table_name) do nothing;

-- The watermark and the version, stamped by the database on every write.
--
-- `before` rather than `after`, so the values are part of the row being written
-- instead of a second update that would itself need a sequence number.
create or replace function sync_stamp() returns trigger
language plpgsql
as $$
begin
  new.server_seq := nextval('sync_seq');
  new.row_version := coalesce(old.row_version, 0) + 1;
  return new;
end;
$$;

-- Give every registered table the three columns, an index for the watermark
-- scan, and the trigger. Idempotent, so a table added to the registry later
-- needs only a second call.
create or replace function sync_prepare() returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
begin
  for t in select table_name from sync_tables order by table_name loop
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;
    execute format('alter table public.%I add column if not exists server_seq bigint', t);
    execute format('alter table public.%I add column if not exists deleted_at timestamptz', t);
    execute format('alter table public.%I add column if not exists row_version integer not null default 0', t);
    -- Ordered by the watermark, which is exactly how the feed reads it.
    execute format('create index if not exists %I on public.%I (server_seq)', t || '_server_seq_idx', t);
    execute format('drop trigger if exists %I on public.%I', t || '_sync_stamp', t);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function sync_stamp()',
      t || '_sync_stamp', t);
    -- Rows that predate this migration have no watermark, so a client would
    -- never see them. One number for all of them: they are all "before the
    -- first change", and their order relative to each other does not matter.
    execute format('update public.%I set server_seq = 0 where server_seq is null', t);
  end loop;
end;
$$;

select sync_prepare();

-- What changed since a watermark, as the caller.
--
-- `security invoker` is the whole point: the function reads the tables with the
-- caller's own privileges, so row-level security decides what comes back and
-- there is no second definition of who may see what. A row that becomes
-- invisible — access revoked, project unshared — simply stops appearing, which
-- is the same signal as a delete and is handled by the client the same way.
--
-- The row travels as `jsonb` (as `row_data`: `row` is reserved) rather than as a typed record because the feed
-- spans tables of different shapes; the client already parses what it stores.
create or replace function sync_changes(p_since bigint default 0, p_limit integer default 500)
returns table (table_name text, row_id uuid, server_seq bigint, deleted_at timestamptz, row_version integer, row_data jsonb)
language plpgsql
security invoker
set search_path = public
as $$
declare
  t text;
  remaining integer := greatest(least(coalesce(p_limit, 500), 2000), 1);
  appended integer;
begin
  for t in select s.table_name from sync_tables s order by s.table_name loop
    exit when remaining <= 0;
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;
    return query execute format(
      'select %L::text, r.id, r.server_seq, r.deleted_at, r.row_version, to_jsonb(r)
         from public.%I r
        where r.server_seq > $1
        order by r.server_seq
        limit $2', t, t)
      using p_since, remaining;
    -- What the last `return query` actually appended, so the limit is a limit
    -- across the whole feed rather than per table.
    get diagnostics appended = row_count;
    remaining := remaining - appended;
  end loop;
end;
$$;

grant execute on function sync_changes(bigint, integer) to authenticated;
