-- Migration: experiments (code/run tracker, git-linked)
-- Per-project. Owned by the `experiments` feature module.

create extension if not exists "pgcrypto";

create table if not exists experiments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) default auth.uid(),
  project_id    uuid references projects(id) on delete cascade,
  name          text not null,
  hypothesis    text,
  status        text not null default 'planned'
                  check (status in ('planned','running','done','failed','abandoned')),
  repo_url      text,
  commit_sha    text,
  branch        text,
  run_command   text,
  config        jsonb not null default '{}',
  metrics       jsonb not null default '{}',
  artifacts     jsonb not null default '[]',
  result_note   text,
  started_at    timestamptz,
  finished_at   timestamptz,
  related_paper uuid references papers(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists experiments_user_project_idx on experiments (user_id, project_id);
create index if not exists experiments_status_idx on experiments (project_id, status);

alter table experiments enable row level security;
drop policy if exists "experiments_select_own" on experiments;
create policy "experiments_select_own" on experiments for select using (auth.uid() = user_id);
drop policy if exists "experiments_modify_own" on experiments;
create policy "experiments_modify_own" on experiments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
