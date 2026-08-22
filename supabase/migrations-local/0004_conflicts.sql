-- Migration: what the device could not decide on its own.
--
-- A conflict is per field, not per row: one device renaming a paper while the
-- other marks it read is not a disagreement, and a design that reports it as
-- one is ignored within a week. So a row here is one collision on one row, and
-- it carries all three sides — base, local, remote — because a reader shown
-- only two of them cannot tell which is the change.
--
-- The base is the row as it stood when the local edit was made. Without it an
-- untouched field is indistinguishable from an edited one and every sync
-- becomes a whole-row collision, so the outbox keeps a copy alongside the op.
alter table sync_outbox add column if not exists base_payload jsonb;

create table if not exists sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  row_id uuid not null,
  base jsonb not null,
  local jsonb not null,
  -- Null until the puller brings the server's version of the row: the pump
  -- knows there is a disagreement before it knows what the other side says.
  remote jsonb,
  -- The fields that actually collided, once both sides are known.
  fields jsonb,
  server_version integer,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists sync_conflicts_open_idx
  on sync_conflicts (created_at)
  where resolved_at is null;

-- One open conflict per row: a second collision on the same row is the same
-- argument continuing, and two rows for it would double the banner.
create unique index if not exists sync_conflicts_row_idx
  on sync_conflicts (table_name, row_id)
  where resolved_at is null;
