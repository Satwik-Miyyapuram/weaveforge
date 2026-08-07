-- Published lab snapshots are immutable.
--
-- 0108 originally granted UPDATE on lab_snapshots to authenticated, and a
-- later uncommitted revision of that file removed it. The revision is the
-- intended behaviour and is now what 0108 says, but any database created from
-- the earlier version still carries the permissive grant — re-running 0108
-- would not remove it, because a `grant` only ever adds.
--
-- The point of the table is that a supervisee freezes a slice of their plan and
-- logbook, and the supervisor reviews exactly that. If the supervisee can edit
-- `content` after publishing, the supervisor cannot trust that what they are
-- reading is what was published, and there is no record that it changed.
-- Correcting a snapshot means deleting it and publishing again, which shows up
-- as a new `published_at`.

revoke update on lab_snapshots from authenticated;

-- Belt and braces: RLS is a second gate, and 0108's policy set never included
-- an UPDATE policy. Drop it explicitly in case an older run created one.
drop policy if exists "lab_snapshots_update_own" on lab_snapshots;

-- 0107's later revision also added this trigger. `updated_at` is meaningless
-- without it: a quotation type is re-classified in place, so the column would
-- otherwise hold the insert time forever.
drop trigger if exists annotation_quotation_types_set_updated_at on annotation_quotation_types;
create trigger annotation_quotation_types_set_updated_at
  before update on annotation_quotation_types
  for each row execute function set_updated_at();
