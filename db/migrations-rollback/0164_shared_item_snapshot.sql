-- Undo 0164 — restores the 0161 kind check and drops profiles.exported_097_at.
--
-- Fails, and changes nothing, while any shared_docs row has kind 'item': the
-- check cannot be restored over them. Move or delete those rows by hand first.
-- Dropping the column also drops every export marker (0.9.7 exports).
--
-- Never applied automatically. Run it deliberately, against a database with a backup.

alter table shared_docs drop constraint if exists shared_docs_kind_check;
alter table shared_docs
  add constraint shared_docs_kind_check
  check (kind in ('annotations', 'canvas', 'feed', 'note'));

alter table profiles drop column if exists exported_097_at;

notify pgrst, 'reload schema';
