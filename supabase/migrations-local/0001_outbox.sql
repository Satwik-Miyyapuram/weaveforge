-- Migration: the tables that exist only on a device.
--
-- These are applied after the shared migrations and only by the desktop app.
-- They are deliberately not in supabase/migrations: an outbox is a record of
-- what this machine still owes the server, and it means nothing on the server
-- itself. Keeping them apart also keeps the shared schema honest — a table that
-- appears in both would invite one to sync itself.

-- What this device has written and the server has not acknowledged.
--
-- Ordered by `seq` and replayable: each entry carries a client-generated op id,
-- so sending the same entry twice is a no-op on the far side. That matters
-- because "did the request land before the connection dropped?" has no general
-- answer, and the only safe reply to not knowing is to send it again.
create table if not exists sync_outbox (
  seq bigserial primary key,
  op_id uuid not null unique default gen_random_uuid(),
  table_name text not null,
  row_id uuid not null,
  -- insert, update or delete. A delete is an op like any other, so it survives
  -- a restart the same way an edit does.
  op text not null check (op in ('insert', 'update', 'delete')),
  -- The row as it stood locally, minus nothing: the server decides what it can
  -- accept, and a partial payload would make that decision on stale grounds.
  payload jsonb not null default '{}'::jsonb,
  -- What the local row was based on, so the server can tell a concurrent edit
  -- from a stale overwrite. Null for an insert, which is based on nothing.
  base_version integer,
  created_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  -- Set when an entry has failed enough times that retrying it is noise. It
  -- stays in the table rather than being dropped: an op that cannot be sent is
  -- work the person did, and it is theirs to see.
  dead_at timestamptz
);

create index if not exists sync_outbox_pending_idx on sync_outbox (seq) where dead_at is null;

-- How far this device has read the server's change feed, and when.
--
-- One row. A watermark rather than a timestamp, because ordering is the
-- server's sequence and a device clock has no standing here.
create table if not exists sync_state (
  id boolean primary key default true check (id),
  watermark bigint not null default 0,
  last_pull_at timestamptz,
  -- Whose data this device holds. Null until sync is turned on, which is also
  -- the moment the local-only rows are re-owned to a real account.
  account_id uuid
);

insert into sync_state (id) values (true) on conflict (id) do nothing;
