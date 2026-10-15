-- What this device keeps offline, and what it spent doing so.
--
-- Device-only: which projects a person wants available with the network off is
-- a property of the machine in front of them, not of the account. The same
-- account on a phone and a desktop will not want the same twelve gigabytes.

create table if not exists offline_projects (
  project_id uuid primary key,
  enabled_at timestamptz not null default now()
);

-- One row per cached file. `last_used_at` is what makes eviction least-recently
-- used rather than arbitrary, and it is updated on read, not on download.
create table if not exists offline_blobs (
  path text primary key,
  project_id uuid,
  bytes bigint not null check (bytes >= 0),
  stored_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create index if not exists offline_blobs_lru on offline_blobs (last_used_at);
create index if not exists offline_blobs_project on offline_blobs (project_id);
