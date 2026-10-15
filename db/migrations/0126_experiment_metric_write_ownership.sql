-- Migration: a metric point may only be written into an experiment its writer
-- owns.
--
-- Both metric stores — the row store `experiment_metric_points` and the
-- archive `experiment_metric_chunks` — bound a write to the *row's* owner and
-- nothing else:
--
--   create policy "experiment_metrics_insert_own" on experiment_metric_points
--     for insert with check ((select auth.uid()) = user_id);
--
-- but SELECT on the same tables is widened by
-- `shared_to_me('experiment', experiment_id)` (0114/0115), and the ingest route
-- inserts the caller's rows verbatim:
--
--   const { error } = await user.db.from("experiment_metrics").insert(toInsert);
--
-- The two rules together are a cross-tenant write. A collaborator who can read
-- a shared experiment can insert a point tagged with *their own* `user_id`
-- pointing at the owner's `experiment_id`. It passes the insert policy, it
-- appears in the owner's charts, and the owner has no UPDATE policy over it —
-- so they can neither correct it nor see where it came from. The curve is the
-- result of someone's training run; a fabricated point on it is fabricated
-- evidence.
--
-- The missing predicate is ownership of the parent: the writer must own the
-- experiment, not just the row. That is one `exists` on a table both stores
-- already join to and whose `id` is the first column of the chunk primary key,
-- so it is an index lookup per row.
--
-- Why UPDATE is tightened as well: without it the insert rule is decorative. An
-- attacker inserts a point into their *own* experiment and then re-points it
-- with an update — the old `with check` only ever looked at `user_id`, which
-- does not change. `using` is tightened too, so a row that already sits in
-- someone else's experiment cannot be updated at all.
--
-- Why DELETE is left alone: delete already reaches only rows whose `user_id` is
-- the caller, so it cannot destroy the owner's data. It stays as it is, and the
-- ingest route's stale-tip cleanup keeps working for the rows it created.
--
-- Why the archives are included: `experiment_metric_chunks` carries the same
-- `grant insert ... to authenticated` and the same row-owner-only insert rule,
-- so PostgREST offered the identical attack against the archive half of the
-- series. The only writer that should ever touch it is
-- `experiment_metrics_rollup()`, which runs as `service_role` and therefore
-- bypasses RLS, leaving this policy to gate nothing but clients.
--
-- What this refuses that used to work: a collaborator running the Python SDK
-- against someone else's shared experiment. That is the attack this migration
-- exists to stop, and no path in the application writes metrics on another
-- user's behalf — the ingest route authenticates the caller's own token, and
-- the web metric repository's only writer is that same route. A collaborator
-- appending to a shared curve now fails the insert rather than succeeding
-- quietly.
--
-- Reversal: re-create the four policies with the `user_id` predicate alone,
-- exactly as 0114/0115 have them.

-- ---------------------------------------------------------------------------
-- The row store.
-- ---------------------------------------------------------------------------

drop policy if exists "experiment_metrics_insert_own" on public.experiment_metric_points;
create policy "experiment_metrics_insert_own" on public.experiment_metric_points
  for insert with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
        from public.experiments e
       where e.id = experiment_metric_points.experiment_id
         and e.user_id = (select auth.uid())
    )
  );

drop policy if exists "experiment_metrics_update_own" on public.experiment_metric_points;
create policy "experiment_metrics_update_own" on public.experiment_metric_points
  for update using (
    (select auth.uid()) = user_id
    and exists (
      select 1
        from public.experiments e
       where e.id = experiment_metric_points.experiment_id
         and e.user_id = (select auth.uid())
    )
  )
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
        from public.experiments e
       where e.id = experiment_metric_points.experiment_id
         and e.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- The archive.
-- ---------------------------------------------------------------------------

drop policy if exists "experiment_metric_chunks_insert_own" on public.experiment_metric_chunks;
create policy "experiment_metric_chunks_insert_own" on public.experiment_metric_chunks
  for insert with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
        from public.experiments e
       where e.id = experiment_metric_chunks.experiment_id
         and e.user_id = (select auth.uid())
    )
  );

drop policy if exists "experiment_metric_chunks_update_own" on public.experiment_metric_chunks;
create policy "experiment_metric_chunks_update_own" on public.experiment_metric_chunks
  for update using (
    (select auth.uid()) = user_id
    and exists (
      select 1
        from public.experiments e
       where e.id = experiment_metric_chunks.experiment_id
         and e.user_id = (select auth.uid())
    )
  )
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
        from public.experiments e
       where e.id = experiment_metric_chunks.experiment_id
         and e.user_id = (select auth.uid())
    )
  );
