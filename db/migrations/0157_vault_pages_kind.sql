-- Migration: a note can be a canvas.
--
-- A canvas is a note whose body is JSON Canvas 1.0 text (Obsidian's `.canvas`
-- format) instead of markdown. It lives in vault_pages, not a table of its own,
-- so it sits in the notes tree, syncs between devices and mirrors to a folder
-- like any other note. The kind tells the app which editor opens the body and
-- which extension the folder mirror writes.
--
-- Nullable on purpose, as `folder` (0154) and `pinned` (0136) are: the
-- desktop's sync apply fills a column absent from a pulled row with NULL, not
-- its default, and rows written by clients older than this migration carry no
-- `kind` key. NULL reads as "a note".

alter table vault_pages
  add column if not exists kind text default 'note';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'vault_pages_kind_check'
  ) then
    alter table vault_pages
      add constraint vault_pages_kind_check
      check (kind is null or kind in ('note', 'canvas'));
  end if;
end $$;
