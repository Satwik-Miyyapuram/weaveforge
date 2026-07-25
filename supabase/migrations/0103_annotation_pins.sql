-- Zotero annotations remain cached on their paper. This table stores the
-- project-scoped user decision that places an annotation in a report section.
create table if not exists annotation_pins (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade default auth.uid(),
  project_id         uuid not null references projects(id) on delete cascade,
  paper_id           uuid not null references papers(id) on delete cascade,
  annotation_key     text not null,
  report_section_id  uuid not null references report_sections(id) on delete cascade,
  created_at         timestamptz not null default now(),
  unique (project_id, paper_id, annotation_key)
);

create index if not exists annotation_pins_project_section_idx
  on annotation_pins (project_id, report_section_id);

alter table annotation_pins enable row level security;

create policy annotation_pins_own on annotation_pins
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

comment on table annotation_pins is
  'Places Zotero annotations cached on papers into report sections.';
