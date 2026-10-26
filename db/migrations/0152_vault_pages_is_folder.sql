-- Migration: a note page can be a folder.
--
-- Notes nest only inside folders: a folder holds pages, a note never does. The
-- flag lives on the page row so it syncs to every device like any other edit.
--
-- Nullable on purpose, like 0136's `pinned`: the desktop's sync apply fills a
-- column absent from a pulled row with NULL, and rows written by older clients
-- carry no `is_folder` key. NULL reads as "a note". No backfill: a page that
-- already holds pages is treated as a folder by the app.

alter table vault_pages
  add column if not exists is_folder boolean default false;
