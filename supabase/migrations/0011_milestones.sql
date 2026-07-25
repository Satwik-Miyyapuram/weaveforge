-- Migration: milestones (forward-looking thesis plan)
-- Per-project. Dependencies (typed refs to milestones/experiments/papers or
-- free-form external needs) and compute requirements are stored as jsonb.
-- Owned by the `plan` feature module.

create extension if not exists "pgcrypto";

create table if not exists milestones (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) default auth.uid(),
  project_id    uuid references projects(id) on delete cascade,
  title         text not null,
  description   text,
  status        text not null default 'planned'
                  check (status in ('planned','in_progress','done','blocked')),
  target_date   date,
  -- [{"kind":"experiment","refId":"..."},{"kind":"external","label":"cluster account"}]
  dependencies  jsonb not null default '[]',
  -- [{"resource":"A100","count":4,"hours":200,"notes":"..."}]
  compute       jsonb not null default '[]',
  created_at    timestamptz not null default now()
);

create index if not exists milestones_user_project_idx on milestones (user_id, project_id);
create index if not exists milestones_target_idx on milestones (project_id, target_date);

alter table milestones enable row level security;
drop policy if exists "milestones_select_own" on milestones;
create policy "milestones_select_own" on milestones for select using (auth.uid() = user_id);
drop policy if exists "milestones_modify_own" on milestones;
create policy "milestones_modify_own" on milestones
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
