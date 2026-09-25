-- Migration: answer "when did each of these runs last log?" where the data is.
--
-- `latestActivityAt` is what decides whether a live training run is still
-- alive: the experiments screen asks it about every running experiment, and a
-- run with no recent activity is marked abandoned. It was reading
-- `select experiment_id, wall_time ... order by wall_time desc` and keeping the
-- first row per experiment in the browser, which is wrong in two ways and
-- expensive in a third.
--
-- ## 1. It is silently wrong above the row cap
--
-- A per-group MAX computed in application code needs the whole group. PostgREST
-- has a server-side row cap (`db-max-rows`; unlimited by default, 1000 on
-- Supabase's platform), and it truncates a response rather than failing it. Once
-- the listed experiments hold more points than the cap, any experiment whose
-- newest point falls outside the truncated window has no entry in the result —
-- and a *missing* entry is not read as "unknown": `isStaleRunningExperiment`
-- falls back to `startedAt`, and the experiments facade then writes
-- `status = "abandoned"` over a run that is training right now. A display bug
-- would be bad enough; this one mutates the database.
--
-- ## 2. It ships every point to compute one number per experiment
--
-- The information content is O(experiments). The transfer was O(points ever
-- logged). That is the same read, on the path that renders the experiments list.
--
-- ## 3. It reads a view that expands every chunk
--
-- Since 0114/0115 `experiment_metrics` is a view: it unions the row store with
-- the *expanded* arrays of the chunk archive and de-duplicates by step. A MAX
-- over the view pays that expansion for the entire history. The two base
-- relations can each answer it directly — and the row store can answer it from
-- an index, which did not exist: the primary key is
-- `(experiment_id, metric_id, step)`, so nothing ordered by `wall_time`.
--
-- ## Shape
--
-- One row per experiment that has any activity at all. An experiment with no
-- points is absent, exactly as it was absent from the map before, so the
-- caller's fallback keeps its present meaning. `max(wall_time)` is taken per
-- store and the greater of the two wins, which is the same answer as a MAX over
-- the view's union: a point may legitimately exist in both (a late write for an
-- already-archived step lands in the row store), and either copy's wall_time is
-- a real observation.
--
-- `security invoker`, so the caller's RLS decides which experiments are visible
-- rather than the function's owner — the same rule the trip through PostgREST
-- applied. `stable` because it reads and does not write, which lets the planner
-- treat it as one snapshot.
--
-- Reversal: supabase/migrations-rollback/0131_metric_activity_rpc.sql
--
-- Re-runnable: both statements are guarded.

-- ---------------------------------------------------------------------------
-- The index the row-store half needs.
-- ---------------------------------------------------------------------------

-- Partial, because `wall_time` is nullable and the query only ever wants rows
-- where it is set: sources that do not report a clock store NULL, and those rows
-- cannot answer "when did this last log?".
create index if not exists experiment_metric_points_activity_idx
  on experiment_metric_points (experiment_id, wall_time desc)
  where wall_time is not null;

-- ---------------------------------------------------------------------------
-- The aggregate.
-- ---------------------------------------------------------------------------

create or replace function latest_metric_activity(p_experiment_ids uuid[])
returns table (experiment_id uuid, last_wall_time timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select ids.experiment_id,
         greatest(points.last_wall_time, chunks.last_wall_time) as last_wall_time
    from unnest(p_experiment_ids) as ids(experiment_id)
    left join (
      select p.experiment_id, max(p.wall_time) as last_wall_time
        from experiment_metric_points p
       where p.experiment_id = any(p_experiment_ids)
         and p.wall_time is not null
       group by p.experiment_id
    ) as points on points.experiment_id = ids.experiment_id
    left join (
      -- One row per chunk, so the array is expanded once per chunk rather than
      -- once per point. `max` ignores the NULLs an individual entry may carry.
      select c.experiment_id, max(w.wall_time) as last_wall_time
        from experiment_metric_chunks c
        cross join lateral unnest(c.wall_times) as w(wall_time)
       where c.experiment_id = any(p_experiment_ids)
       group by c.experiment_id
    ) as chunks on chunks.experiment_id = ids.experiment_id
   -- `greatest` returns the larger non-null argument, so this drops only the
   -- experiments that have no activity anywhere.
   where greatest(points.last_wall_time, chunks.last_wall_time) is not null;
$$;

-- `revoke ... from public` does not remove the `anon` entry that
-- `alter default privileges` puts on every new function in this schema (see the
-- measurement in 0123_function_execute_grants.sql), so both are named.
revoke all on function latest_metric_activity(uuid[]) from public;
revoke all on function latest_metric_activity(uuid[]) from anon;
grant execute on function latest_metric_activity(uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The curve read, bounded by the caller's budget.
-- ---------------------------------------------------------------------------

-- `history()` returns every stored sample. Ingest bounds how many that is per
-- series (Fix C of the metrics storage plan: every point below step 10 000, then
-- a sampling rate that halves once per octave, so ~10k for a short run and ~40k
-- for a 400k-step one), but 40k points per metric, times the metrics a chart
-- overlays, is not what an 800-pixel line needs — and every one of them is
-- transferred, parsed and laid out in the browser.
--
-- So the caller may set a budget, and the reduction happens here: the response
-- is bounded by construction, which is also what makes it independent of the
-- server's row cap. Below the budget nothing is dropped and the answer is
-- byte-for-byte what the unbounded read returned.
--
-- The reduction is a stride, not an average. Averaging a loss curve smooths the
-- spikes a spike is the reason to look at; picking every nth sample keeps the
-- points that were measured. The first and last sample of each series always
-- survive whatever the stride, because a curve that loses its endpoint reads as
-- a run that started late or stopped early. That can put the result up to two
-- points over the budget, which is the right way round.
--
-- Read through the view rather than the two stores: the view already resolves
-- which copy of a step wins (0115's `distinct on`, loose row first), and a
-- second implementation of that would be a second answer to the same question.
create or replace function metric_history(
  p_experiment_id uuid,
  p_metric text default null,
  p_max_points int default 2000
)
returns table (metric text, step int, value double precision, wall_time timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  with budget as (
    -- At least two, so "keep the first and the last" is always satisfiable.
    select greatest(coalesce(p_max_points, 2000), 2) as max_points
  ),
  series as (
    select m.metric, m.step, m.value, m.wall_time,
           row_number() over (partition by m.metric order by m.step) as position,
           count(*)     over (partition by m.metric)                as total
      from experiment_metrics m
     where m.experiment_id = p_experiment_id
       and (p_metric is null or m.metric = p_metric)
  )
  select s.metric, s.step, s.value, s.wall_time
    from series s, budget b
   where s.total <= b.max_points
      or s.position = 1
      or s.position = s.total
      or (s.position - 1) % greatest(1, ceil(s.total::numeric / b.max_points)::int) = 0
   order by s.metric, s.step;
$$;

revoke all on function metric_history(uuid, text, int) from public;
revoke all on function metric_history(uuid, text, int) from anon;
grant execute on function metric_history(uuid, text, int) to authenticated, service_role;
