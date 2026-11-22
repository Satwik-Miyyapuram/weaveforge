-- Undo 0164 — restores the 0161 kind check and removes mark_exported_097() and
-- its guard trigger. Keeps the profiles export marker column and its data.
--
-- Fails, and changes nothing, while any shared_docs row has kind 'item': the
-- check cannot be restored over them. Pre-check, and move or delete those rows
-- by hand first:
--   select item_id, owner from shared_docs where kind = 'item';
--
-- Never applied automatically. Run it deliberately, against a database with a backup.

drop trigger if exists profiles_guard_export_marker on profiles;
drop function if exists profiles_guard_export_marker();
drop function if exists mark_exported_097();

alter table shared_docs drop constraint if exists shared_docs_kind_check;
alter table shared_docs
  add constraint shared_docs_kind_check
  check (kind in ('annotations', 'canvas', 'feed', 'note'));

notify pgrst, 'reload schema';
