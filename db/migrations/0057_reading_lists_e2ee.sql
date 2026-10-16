-- E2EE for reading lists (name, description, item notes) + scrub legacy plaintext titles.

alter table reading_lists
  add column if not exists content_enc text,
  add column if not exists enc_epoch int;

alter table reading_list_items
  add column if not exists content_enc text,
  add column if not exists enc_epoch int;

-- Encrypted rows should not retain readable titles in SQL columns.
update papers set title = '' where content_enc is not null and title <> '';
update milestones set title = '' where content_enc is not null and title <> '';
update reading_lists set name = '', description = null
  where content_enc is not null and (name <> '' or description is not null);
update reading_list_items set note = null
  where content_enc is not null and note is not null;
