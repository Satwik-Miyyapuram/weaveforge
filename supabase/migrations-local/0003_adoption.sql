-- Migration: hand a device's local work to an account, once.
--
-- Adoption is an ownership change, not an id remapping pass: rows keep the ids
-- they were minted with, so nothing that references a row — a citation, a link,
-- an edge in the graph — has to be rewritten. Two machines minting uuids
-- independently do not collide, which is what makes that safe.
--
-- `sync_claim` rewrites the owner column on every synced table that has one.
-- The synthetic local user is the only owner it will move: a row already owned
-- by an account belongs to a completed adoption, and moving it again would take
-- work from one account and give it to another.
create or replace function sync_claim(p_account uuid, p_local uuid) returns integer
language plpgsql
as $$
declare
  t text;
  owner_column text;
  moved integer := 0;
  touched integer;
begin
  for t in select s.table_name from sync_tables s order by s.table_name loop
    select c.column_name into owner_column
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = t and c.column_name = 'user_id';
    continue when owner_column is null;

    -- The flag keeps the claim off the wire as an edit per row: the backfill
    -- below sends each row once, whole, which says the same thing in one op.
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

-- Every adopted row, queued as one insert each, oldest first.
--
-- The rows are already the device's truth; the server has never seen them. An
-- insert carrying the whole row is what the puller on the other device expects
-- to receive, and it is idempotent on the server because the id is the row's
-- own. `base_version` is null because there is no version to be based on yet.
create or replace function sync_backfill(p_account uuid) returns integer
language plpgsql
as $$
declare
  t text;
  owned boolean;
  queued integer := 0;
  appended integer;
begin
  for t in select s.table_name from sync_tables s order by s.table_name loop
    -- Owner-scoped tables send only this account's rows. Tables without an
    -- owner column are scoped by their parent row, so they follow it whole.
    select exists (
      select 1 from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = t and c.column_name = 'user_id'
    ) into owned;
    execute format(
      'insert into sync_outbox (table_name, row_id, op, payload, base_version)
         select %L, r.id, ''insert'', to_jsonb(r), null from public.%I r
          where r.deleted_at is null and (%s)
          order by r.id',
      t, t, case when owned then 'r.user_id = $1' else 'true' end)
      using p_account;
    get diagnostics appended = row_count;
    queued := queued + appended;
  end loop;
  return queued;
end;
$$;
