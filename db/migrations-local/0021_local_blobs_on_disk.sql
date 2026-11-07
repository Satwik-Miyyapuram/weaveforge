-- Attachment bytes as files on disk, the row only an index.
--
-- Base64 in a table costs a third more space, and every backup and dump
-- carries every PDF again. The Rust shell keeps each attachment as a file in
-- its data folder instead; a row written that way has `on_disk` set and no
-- bytes. Rows written before stay inline and are still read as they are, so
-- nothing is moved in bulk. A shell without the file commands keeps writing
-- inline rows, as before.
alter table public.local_blobs alter column bytes drop not null;
alter table public.local_blobs add column if not exists on_disk boolean not null default false;

alter table public.local_blobs drop constraint if exists local_blobs_bytes_or_disk;
alter table public.local_blobs
  add constraint local_blobs_bytes_or_disk check (on_disk or bytes is not null);
