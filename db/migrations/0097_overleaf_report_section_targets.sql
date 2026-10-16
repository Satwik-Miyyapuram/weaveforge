-- Per-section word targets for a linked Overleaf report. The section tree is
-- parsed live from the .tex on each fetch, so there is no section row to hang a
-- target off of; we keep a small map { sectionKey -> targetWords } on the report
-- instead. sectionKey is the lowercased title path (e.g. "chapter 2 > methods"),
-- which survives line-number churn better than a positional id.
--
-- Overleaf content is already outside E2EE (disclosed in the UI), so these
-- integers are plain. RLS on overleaf_linked_reports already scopes by user.

alter table overleaf_linked_reports
  add column if not exists section_targets jsonb not null default '{}'::jsonb;
