-- Undo 0164 — restores the 0161 kind check. Leaves the profiles export marker in place.
--
-- Fails, and changes nothing, while any shared_docs row has kind 'item': the
-- check cannot be restored over them. Move or delete those rows by hand first.
--
-- Never applied automatically. Run it deliberately, against a database with a backup.

alter table shared_docs drop constraint if exists shared_docs_kind_check;
alter table shared_docs
  add constraint shared_docs_kind_check
  check (kind in ('annotations', 'canvas', 'feed', 'note'));

notify pgrst, 'reload schema';
