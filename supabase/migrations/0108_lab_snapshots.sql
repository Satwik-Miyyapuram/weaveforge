-- Phase F2 — lab snapshot publishing (OSF-style freeze-and-publish).
--
-- Supervisors today see live raw milestones and log entries via can_access.
-- A lab_snapshot freezes a project's plan + logbook at publish time so the
-- supervisee chooses what the supervisor reviews, instead of continuous
-- raw-log exposure.
--
-- SELECT is broadened with can_access(user_id) (same as milestones / logs in
-- 0015). Writes stay owner-only.
--
-- Authored for human review per roadmap decision D4 — DO NOT apply
-- automatically. A human applies this after review.

create table if not exists lab_snapshots (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade default auth.uid(),
  project_id     uuid not null references projects(id) on delete cascade,
  title          text not null,
  note           text,
  -- Frozen { milestones: [...], logs: [...] } at publish time.
  content        jsonb not null,
  published_at   timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create index if not exists lab_snapshots_user_published_idx
  on lab_snapshots (user_id, published_at desc);

create index if not exists lab_snapshots_project_idx
  on lab_snapshots (project_id);

alter table lab_snapshots enable row level security;

grant select, insert, update, delete on lab_snapshots to authenticated;

drop policy if exists lab_snapshots_select_access on lab_snapshots;
create policy lab_snapshots_select_access on lab_snapshots
  for select
  to authenticated
  using (can_access(user_id));

drop policy if exists lab_snapshots_insert_own on lab_snapshots;
create policy lab_snapshots_insert_own on lab_snapshots
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists lab_snapshots_update_own on lab_snapshots;
create policy lab_snapshots_update_own on lab_snapshots
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists lab_snapshots_delete_own on lab_snapshots;
create policy lab_snapshots_delete_own on lab_snapshots
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

comment on table lab_snapshots is
  'Published freezes of a project plan + logbook for supervisor review.';
