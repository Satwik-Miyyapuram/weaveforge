-- Migration: shared items as snapshots.
--
-- A shared item (a note, canvas, feed or annotation set) is stored in shared_docs
-- as a JSON snapshot of its row: state is {type, row}, the same shape as a feed.
-- 'item' is the kind for those snapshots. Nothing here changes existing rows.
--
-- profiles.exported_097_at is the server-side marker that a user's local data was
-- exported in 0.9.7. Only a verified export sets it. Null means not exported yet.

alter table shared_docs drop constraint if exists shared_docs_kind_check;
alter table shared_docs
  add constraint shared_docs_kind_check
  check (kind in ('annotations', 'canvas', 'feed', 'item', 'note'));

alter table profiles
  add column if not exists exported_097_at timestamptz null;

notify pgrst, 'reload schema';
