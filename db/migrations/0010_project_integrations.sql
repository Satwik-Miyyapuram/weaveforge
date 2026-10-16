-- Migration: per-project git sync integrations (GitHub for code, GitLab for logs)
-- Tokens stored as plain text, protected by RLS via the parent project's owner.
-- Owned by the `sync` feature module.

create table if not exists project_integrations (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  provider    text not null check (provider in ('github','gitlab')),
  enabled     boolean not null default false,
  token       text,
  repo        text,          -- "owner/name" (GitHub) or project path/id (GitLab)
  branch      text not null default 'main',
  updated_at  timestamptz not null default now(),
  unique (project_id, provider)
);

create index if not exists project_integrations_project_idx
  on project_integrations (project_id);

alter table project_integrations enable row level security;

drop policy if exists "project_integrations_select_own" on project_integrations;
create policy "project_integrations_select_own" on project_integrations
  for select using (
    exists (select 1 from projects p where p.id = project_integrations.project_id and p.user_id = auth.uid())
  );

drop policy if exists "project_integrations_modify_own" on project_integrations;
create policy "project_integrations_modify_own" on project_integrations
  for all using (
    exists (select 1 from projects p where p.id = project_integrations.project_id and p.user_id = auth.uid())
  )
  with check (
    exists (select 1 from projects p where p.id = project_integrations.project_id and p.user_id = auth.uid())
  );
