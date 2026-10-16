-- Phase R3 — local reader annotations.
--
-- Zotero-origin annotations stay cached on papers.metadata.annotations and are
-- projected at read time. Local annotations live here so a Zotero sync that
-- replaces the metadata array cannot destroy user work.
--
-- sync_state / zotero_version are reserved for R5 write-back; unused until then.
--
-- Authored for human review per roadmap decision D4 — DO NOT apply
-- automatically. A human applies this after review.

create table if not exists reader_annotations (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade default auth.uid(),
  project_id     uuid not null references projects(id) on delete cascade,
  paper_id       uuid not null references papers(id) on delete cascade,
  origin         text not null default 'local'
                   check (origin in ('local', 'zotero')),
  zotero_key     text,
  -- Zotero's complete type set. No 'strikeout'.
  type           text not null
                   check (type in ('highlight', 'underline', 'note', 'image', 'ink', 'text')),
  color          text not null default '#ffd400',
  text           text not null default '',
  comment        text not null default '',
  tags           text[] not null default '{}',
  -- CombinedPdfAnchor JSON
  anchor         jsonb not null,
  page_index     integer not null,
  sort_index     text not null default '',
  zotero_version integer,
  sync_state     text not null default 'local'
                   check (sync_state in ('local', 'synced', 'pending', 'conflict')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (project_id, paper_id, zotero_key)
);

create index if not exists reader_annotations_page_idx
  on reader_annotations (project_id, paper_id, page_index);

alter table reader_annotations enable row level security;

grant select, insert, update, delete on reader_annotations to authenticated;

drop policy if exists reader_annotations_own on reader_annotations;
create policy reader_annotations_own on reader_annotations
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop trigger if exists reader_annotations_set_updated_at on reader_annotations;
create trigger reader_annotations_set_updated_at
  before update on reader_annotations
  for each row execute function set_updated_at();

comment on table reader_annotations is
  'Local (and later synced) PDF annotations for the in-app reader.';
