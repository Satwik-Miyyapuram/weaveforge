-- Undo 0131 — drop the two read functions and the index behind the first.
--
-- Lossless by construction: both are read-only and the index is derived data.
-- Two consequences, both in the browser: the stale-run check goes back to
-- reading every point of every running experiment and reducing it in the client
-- (which is also where it was silently wrong above the server's row cap), and a
-- chart goes back to receiving every stored sample instead of at most its
-- budget.
--
-- Safe to run more than once, and a no-op if 0131 was never applied.

drop function if exists public.latest_metric_activity(uuid[]);

drop function if exists public.metric_history(uuid, text, int);

drop index if exists experiment_metric_points_activity_idx;
