-- Project-scoped custom fields on papers (defs + per-paper values).
-- Values cascade when a paper or field definition is deleted.

create table if not exists paper_field_defs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null,
  kind        text not null
              check (kind in ('text', 'number', 'select', 'multi_select')),
  options     jsonb not null default '[]'::jsonb,
  sort_order  integer not null default 0,
  unique (project_id, name)
);

create index if not exists paper_field_defs_project_sort_idx
  on paper_field_defs (project_id, sort_order);

create table if not exists paper_field_values (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  project_id  uuid not null references projects(id) on delete cascade,
  paper_id    uuid not null references papers(id) on delete cascade,
  field_id    uuid not null references paper_field_defs(id) on delete cascade,
  value       jsonb not null,
  unique (project_id, paper_id, field_id)
);

create index if not exists paper_field_values_paper_idx
  on paper_field_values (project_id, paper_id);

create index if not exists paper_field_values_field_idx
  on paper_field_values (project_id, field_id);

alter table paper_field_defs enable row level security;
alter table paper_field_values enable row level security;

create policy paper_field_defs_own on paper_field_defs
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy paper_field_values_own on paper_field_values
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

comment on table paper_field_defs is
  'Project-scoped custom field definitions for papers (text/number/select/multi_select).';
comment on table paper_field_values is
  'Per-paper values for project custom fields; cascades with paper or field def delete.';
