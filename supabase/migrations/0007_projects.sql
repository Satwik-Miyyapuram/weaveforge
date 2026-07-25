-- Migration: projects + per-project scoping
-- Everything becomes scoped to a project. Adds projects table, a project_id FK
-- on every top-level entity, backfills a default project for existing data,
-- and RLS for projects. Owned by the `projects` feature module.

create extension if not exists "pgcrypto";

create table if not exists projects (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) default auth.uid(),
  name          text not null,
  color         text,
  created_at    timestamptz not null default now()
);

create index if not exists projects_user_idx on projects (user_id);

alter table projects enable row level security;
drop policy if exists "projects_select_own" on projects;
create policy "projects_select_own" on projects for select using (auth.uid() = user_id);
drop policy if exists "projects_modify_own" on projects;
create policy "projects_modify_own" on projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Add nullable project_id to each scoped table.
alter table papers           add column if not exists project_id uuid references projects(id) on delete cascade;
alter table log_entries      add column if not exists project_id uuid references projects(id) on delete cascade;
alter table report_sections  add column if not exists project_id uuid references projects(id) on delete cascade;
alter table reading_lists    add column if not exists project_id uuid references projects(id) on delete cascade;
alter table paper_relations  add column if not exists project_id uuid references projects(id) on delete cascade;

-- Backfill: one default project per user that already has data, then point
-- existing rows at it. Migration runs as service role (RLS bypassed).
insert into projects (user_id, name)
  select distinct user_id, 'My Thesis'
  from (
    select user_id from papers
    union select user_id from log_entries
    union select user_id from report_sections
    union select user_id from reading_lists
    union select user_id from paper_relations
  ) u
  where user_id is not null
    and not exists (select 1 from projects p where p.user_id = u.user_id);

update papers          t set project_id = p.id from projects p where p.user_id = t.user_id and t.project_id is null;
update log_entries     t set project_id = p.id from projects p where p.user_id = t.user_id and t.project_id is null;
update report_sections t set project_id = p.id from projects p where p.user_id = t.user_id and t.project_id is null;
update reading_lists   t set project_id = p.id from projects p where p.user_id = t.user_id and t.project_id is null;
update paper_relations t set project_id = p.id from projects p where p.user_id = t.user_id and t.project_id is null;

create index if not exists papers_project_idx          on papers (project_id);
create index if not exists log_entries_project_idx     on log_entries (project_id);
create index if not exists report_sections_project_idx on report_sections (project_id);
create index if not exists reading_lists_project_idx   on reading_lists (project_id);
create index if not exists paper_relations_project_idx on paper_relations (project_id);
