-- Migration: index `experiment_metric_chunks.user_id`.
--
-- The column is on the archive table and carries the same meaning it has on the
-- row store — it is the owner the RLS policies filter on. `0114` gave
-- `experiment_metric_points` an index for exactly that (`user_id` "keeps its
-- index — RLS filters on it") and `0115` did not give the chunk table the same
-- one, so every policy evaluation against the archive is a sequential scan.
--
-- It is worth an index rather than a shrug: the archive is the *large* half of
-- the series. `experiment_metrics_rollup()` moves settled points out of the row
-- store and into chunks precisely because a chunk row is cheap and there are
-- far more points than rows — so the table with no `user_id` index is the one
-- whose scan grows with the amount of data a user has ever logged.
--
-- The primary key is `(experiment_id, metric_id, chunk_no)`, which serves the
-- read path; it cannot serve a filter on `user_id`, because the leading column
-- is not `user_id` and the policies run before any ordering.
--
-- Reversal: `drop index if exists public.experiment_metric_chunks_user_id_idx;`

create index if not exists experiment_metric_chunks_user_id_idx
  on public.experiment_metric_chunks (user_id);
