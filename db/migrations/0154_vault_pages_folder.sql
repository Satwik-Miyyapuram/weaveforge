-- Migration: a note can be a folder.
--
-- The explorer only lets folders hold children: a note holds nothing. Without a
-- flag, an empty folder and an empty note are the same row, so the flag lives
-- on the page and syncs like any other edit. It defaults to false, so every
-- existing page stays a note.
--
-- Nullable on purpose, as `pinned` (0136) is: the desktop's sync apply fills a
-- column absent from a pulled row with NULL, not its default, and rows written
-- by clients older than this migration carry no `folder` key. NULL reads as
-- "a note".

alter table vault_pages
  add column if not exists folder boolean default false;
