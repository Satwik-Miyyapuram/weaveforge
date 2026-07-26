-- Phase F1 — first-class quotation types on Zotero annotation cards.
--
-- Zotero sync replaces papers.metadata.annotations, so a user taxonomy
-- (direct / paraphrase / summary) must not live only in that array. Mirror
-- annotation_pins (0103): a side table keyed by (project, paper, annotation_key).
--
-- Authored for human review per roadmap decision D4 — DO NOT apply
-- automatically. A human applies this after review.

create table if not exists annotation_quotation_types (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade default auth.uid(),
  project_id         uuid not null references projects(id) on delete cascade,
  paper_id           uuid not null references papers(id) on delete cascade,
  annotation_key     text not null,
  quotation_type     text not null
                       check (quotation_type in ('direct', 'paraphrase', 'summary')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (project_id, paper_id, annotation_key)
);

create index if not exists annotation_quotation_types_paper_idx
  on annotation_quotation_types (project_id, paper_id);

alter table annotation_quotation_types enable row level security;

grant select, insert, update, delete on annotation_quotation_types to authenticated;

drop policy if exists annotation_quotation_types_own on annotation_quotation_types;
create policy annotation_quotation_types_own on annotation_quotation_types
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

comment on table annotation_quotation_types is
  'Citavi-style quotation taxonomy for Zotero annotations cached on papers.';
