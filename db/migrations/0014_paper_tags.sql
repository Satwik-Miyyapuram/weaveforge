-- Migration: keyword tags on papers.
-- Derived from the reader's summary and Zotero PDF annotations (or edited by
-- hand), normalized (lowercase, no leading '#'). Used by filters + the graph.
-- Owned by the `papers` feature module.

alter table papers add column if not exists tags text[] not null default '{}';

-- GIN index for tag-overlap / contains queries.
create index if not exists papers_tags_idx on papers using gin (tags);
