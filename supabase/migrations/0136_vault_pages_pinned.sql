-- Migration: a note can be pinned by its owner.
--
-- The Notes screen shows the owner's pinned notes in their own section above
-- the rest. The flag lives on the page row, so it syncs to every device like
-- any other edit, and it defaults to false so existing notes are unchanged.

alter table vault_pages
  add column if not exists pinned boolean not null default false;
