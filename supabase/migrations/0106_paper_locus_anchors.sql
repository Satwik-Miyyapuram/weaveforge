-- Phase D — persisted jump-to-locus anchors.
--
-- A locus is a durable W3C text anchor (TextQuoteSelector + optional
-- TextPositionSelector) into a paper's extracted PDF text. The reader resolves
-- it by quote first, position second (see packages/core/src/reader). Storing it
-- lets provenance deep links and saved highlights survive re-extraction without
-- re-deriving offsets.
--
-- Selector text is a verbatim excerpt of the source PDF, so it is treated as
-- user content: RLS is owner-only and the anchor JSON lives in `content` under
-- the same at-rest posture as ai_proposals (migration 0100). `page_index` and
-- `content_hash` stay as columns for cheap lookups and staleness checks.
--
-- Authored for human review per roadmap decision D4 — DO NOT apply
-- automatically. A human applies this after review.

create table if not exists paper_locus_anchors (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade default auth.uid(),
  project_id    uuid not null references projects(id) on delete cascade,
  paper_id      uuid not null references papers(id) on delete cascade,
  -- Caller-supplied stable key (e.g. proposal/source id) for upsert + dedupe.
  anchor_key    text not null,
  -- 0-based page hint; null when the anchor is document-scoped.
  page_index    integer,
  -- Content hash of the extracted text the anchor was created against; a
  -- mismatch at resolve time downgrades confidence rather than jumping wrong.
  content_hash  text,
  -- { quote: TextQuoteSelector, position?: TextPositionSelector } as JSON.
  content       jsonb not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (project_id, paper_id, anchor_key)
);

create index if not exists paper_locus_anchors_user_project_idx
  on paper_locus_anchors (user_id, project_id);

create index if not exists paper_locus_anchors_paper_idx
  on paper_locus_anchors (paper_id);

alter table paper_locus_anchors enable row level security;

create policy paper_locus_anchors_own on paper_locus_anchors
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

comment on table paper_locus_anchors is
  'Durable W3C text anchors into a paper''s extracted PDF text for jump-to-locus; owner-only, read-only reader surface (Phase D).';
