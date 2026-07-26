-- Phase F corrections — two defects found reviewing 0107 and 0108 after they
-- were applied. Both are forward fixes; 0107 and 0108 are left untouched
-- because they are already live (roadmap decision D4).
--
-- Authored for human review per roadmap decision D4 — DO NOT apply
-- automatically. A human applies this after review.

-- ---------------------------------------------------------------------------
-- 1. annotation_quotation_types.updated_at was never maintained.
--
-- 0107 added the column but no trigger, so it holds the insert time forever.
-- A quotation type is specifically the kind of value that gets re-classified
-- in place (direct -> paraphrase), so a stale updated_at is silently wrong
-- rather than merely unused. `annotation_pins` (0103), which 0107 mirrors,
-- has no updated_at at all and needs no trigger — that is why the omission
-- was easy to miss.
-- ---------------------------------------------------------------------------

drop trigger if exists annotation_quotation_types_set_updated_at
  on annotation_quotation_types;
create trigger annotation_quotation_types_set_updated_at
  before update on annotation_quotation_types
  for each row execute function set_updated_at();

-- Backfill is a no-op by design: rows never updated should keep created_at as
-- their updated_at, which is already the value they hold.

-- ---------------------------------------------------------------------------
-- 2. lab_snapshots was editable after publication, which defeats the freeze.
--
-- A snapshot exists so a supervisee can choose what a supervisor reviews,
-- instead of exposing the live log. If the owner can rewrite `content` after
-- publishing, the supervisor cannot trust that what they are looking at is
-- what was published — and the change leaves no trace, because published_at
-- does not move on update.
--
-- Nothing in the application ever called update on this table, so removing
-- the capability breaks no code path. Correcting a snapshot now means
-- deleting it and publishing again, which is visible via published_at.
-- ---------------------------------------------------------------------------

drop policy if exists lab_snapshots_update_own on lab_snapshots;
revoke update on lab_snapshots from authenticated;

comment on table lab_snapshots is
  'Published freezes of a project plan + logbook for supervisor review. '
  'Immutable once published (no UPDATE grant, 0109) — delete and republish '
  'to correct one, so the change is visible in published_at.';
