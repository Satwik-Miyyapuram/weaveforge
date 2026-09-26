-- Migration: a note can be pinned by its owner.
--
-- The Notes screen shows the owner's pinned notes in their own section above
-- the rest. The flag lives on the page row, so it syncs to every device like
-- any other edit, and it defaults to false so existing notes are unchanged.
--
-- Nullable on purpose. The desktop's sync apply fills a column absent from a
-- pulled row with NULL, not its default, and rows written by clients older than
-- this migration carry no `pinned` key. NULL reads as "not pinned".

alter table vault_pages
  add column if not exists pinned boolean default false;

-- A database that ran the first version of this migration has it NOT NULL.
alter table vault_pages
  alter column pinned drop not null;
