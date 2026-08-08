-- Fix B of docs/future-work/metrics-storage-plan.md — pack settled points into
-- arrays, so the per-row tuple header stops being paid once per measurement.
--
-- After 0114 a point costs 132 B at scale, and almost all of that is per-row
-- overhead rather than the 20 B of actual measurement. Packing many points into
-- one row amortises the header, the item pointer and the index entry across the
-- whole chunk. Measured at 200k points: 132.4 → 21.3 B/point, a further 6.3×.
--
-- ## Shape
--
-- One row per `(experiment_id, metric_id, chunk_no)` holding parallel arrays.
-- `steps` is stored explicitly rather than derived from a start offset because
-- real series have gaps — a validation metric logged every 50 steps is not
-- contiguous, and reconstructing it from `start_step` alone would be wrong.
--
-- 21.3 B/point is short of the plan's projected 10–15. The gap is exactly the
-- fidelity the plan's own checklist asks for: `wall_times` costs 8 B/point and
-- explicit `steps` 4 B/point. Dropping per-point wall times would reach ~13 B,
-- but `MetricPoint.wallTime` is part of the domain type and read back by
-- `history()`, so that is a product decision, not a storage one.
--
-- ## Why chunks are an archive, not the write path
--
-- The obvious design — append each incoming point to an open chunk — rewrites
-- the whole array on every append, because Postgres has no in-place array
-- append. Filling a 250-point chunk one point at a time writes ~250 versions of
-- a growing row: hundreds of times the data the chunk finally holds.
--
-- So writes keep going to `experiment_metric_points` exactly as they did after
-- 0114, and `experiment_metrics_rollup()` moves settled points into chunks in
-- whole batches. Each chunk is written once. Density does not suffer: measured
-- across chunk sizes 50/100/250/1000 the cost per point is flat at 21–24 B,
-- because the arrays dominate and tuple overhead is already amortised by 50.
--
-- The newest {@link HOT_TAIL} points of each series deliberately stay as rows.
-- That is where re-ingests, out-of-order arrivals and the downsampler's tip
-- rewriting all happen, and rows absorb those cheaply while arrays would not.
--
-- ## Reading
--
-- The view unions the expanded chunks with the loose rows and de-duplicates by
-- step, preferring the row. A point can legitimately exist in both — a late
-- write for an already-archived step lands in the row store — and the row is by
-- definition the newer of the two, which keeps the last-write-wins behaviour
-- 0114 established.
--
-- Reversal: supabase/migrations-rollback/0115_experiment_metric_chunks.sql
--
-- Re-runnable: the table is created if absent and the view is replaced.

create table if not exists experiment_metric_chunks (
  experiment_id uuid not null references experiments(id) on delete cascade,
  user_id       uuid not null references auth.users(id),
  metric_id     int  not null references experiment_metric_names(id),
  chunk_no      int  not null,
  -- Parallel arrays, all the same length. `wall_times` is not null so that
  -- `unnest(steps, values, wall_times)` zips correctly; individual entries may
  -- be null, because plenty of sources do not report a wall clock.
  steps         int[] not null,
  values        double precision[] not null,
  wall_times    timestamptz[] not null,
  primary key (experiment_id, metric_id, chunk_no),
  constraint experiment_metric_chunks_lengths_match check (
    cardinality(steps) = cardinality(values)
    and cardinality(steps) = cardinality(wall_times)
    and cardinality(steps) > 0
  )
);

alter table experiment_metric_chunks enable row level security;

-- The same rules as the row store: your own runs, plus anything shared with you.
drop policy if exists "experiment_metric_chunks_select_access" on experiment_metric_chunks;
create policy "experiment_metric_chunks_select_access" on experiment_metric_chunks
  for select using (
    (select auth.uid()) = user_id
    or shared_to_me('experiment', experiment_id)
  );

drop policy if exists "experiment_metric_chunks_insert_own" on experiment_metric_chunks;
create policy "experiment_metric_chunks_insert_own" on experiment_metric_chunks
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "experiment_metric_chunks_update_own" on experiment_metric_chunks;
create policy "experiment_metric_chunks_update_own" on experiment_metric_chunks
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "experiment_metric_chunks_delete_own" on experiment_metric_chunks;
create policy "experiment_metric_chunks_delete_own" on experiment_metric_chunks
  for delete using ((select auth.uid()) = user_id);

grant select, insert, update, delete on experiment_metric_chunks to authenticated;
grant select, insert, update, delete on experiment_metric_chunks to service_role;

-- ---------------------------------------------------------------------------
-- The read path.
-- ---------------------------------------------------------------------------

create or replace view experiment_metrics
  with (security_invoker = true)
as
  with expanded as (
    select c.user_id,
           c.experiment_id,
           c.metric_id,
           u.step,
           u.value,
           u.wall_time,
           0 as prefer          -- archived copy loses to a loose row
      from experiment_metric_chunks c
      cross join lateral unnest(c.steps, c.values, c.wall_times)
        as u(step, value, wall_time)
    union all
    select p.user_id, p.experiment_id, p.metric_id, p.step, p.value, p.wall_time, 1 as prefer
      from experiment_metric_points p
  )
  select distinct on (e.experiment_id, e.metric_id, e.step)
         e.user_id,
         e.experiment_id,
         n.name as metric,
         e.step,
         e.value,
         e.wall_time
    from expanded e
    join experiment_metric_names n on n.id = e.metric_id
   order by e.experiment_id, e.metric_id, e.step, e.prefer desc;

grant select, insert, update, delete on experiment_metrics to authenticated;
grant select, insert, update, delete on experiment_metrics to service_role;

-- The INSTEAD OF triggers from 0114 are still attached and still correct:
-- writes go to `experiment_metric_points`, which is exactly where they should
-- go. Recreating the view drops them, so they are re-established here.

drop trigger if exists experiment_metrics_insert_trg on experiment_metrics;
create trigger experiment_metrics_insert_trg
  instead of insert on experiment_metrics
  for each row execute function experiment_metrics_insert();

-- Deleting and updating have to reach both stores now. The 0114 versions only
-- knew about rows, so once a point had been archived, deleting it reported
-- success and changed nothing, and updating it silently kept the old value.

/**
 * Remove one point from wherever it lives.
 *
 * Shared by the delete and update triggers so the two cannot disagree about
 * where a point might be hiding.
 */
create or replace function experiment_metric_point_remove(
  p_experiment_id uuid,
  p_metric_id int,
  p_step int
)
returns void
language plpgsql
security invoker
as $$
declare
  v_pos int;
begin
  delete from experiment_metric_points
   where experiment_id = p_experiment_id
     and metric_id     = p_metric_id
     and step          = p_step;

  -- Cut the point out of the parallel arrays of whichever chunk holds it.
  select array_position(c.steps, p_step) into v_pos
    from experiment_metric_chunks c
   where c.experiment_id = p_experiment_id
     and c.metric_id     = p_metric_id
     and p_step = any(c.steps)
   limit 1;

  if v_pos is not null then
    update experiment_metric_chunks c
       set steps      = steps[:v_pos-1]      || steps[v_pos+1:],
           values     = values[:v_pos-1]     || values[v_pos+1:],
           wall_times = wall_times[:v_pos-1] || wall_times[v_pos+1:]
     where c.experiment_id = p_experiment_id
       and c.metric_id     = p_metric_id
       and p_step = any(c.steps);

    -- The length check forbids empty arrays, so an emptied chunk must go.
    delete from experiment_metric_chunks
     where experiment_id = p_experiment_id
       and metric_id     = p_metric_id
       and cardinality(steps) = 0;
  end if;
end;
$$;

revoke all on function experiment_metric_point_remove(uuid, int, int) from public;
grant execute on function experiment_metric_point_remove(uuid, int, int) to authenticated, service_role;

/**
 * Update as remove-then-insert.
 *
 * Editing an array element in place would need a second code path that only
 * runs for archived points — the one that was already wrong once. Removing the
 * old point wherever it is and letting the new one land in the row store gives
 * one path, and the row store is where a freshly-written point belongs anyway.
 */
create or replace function experiment_metrics_update()
returns trigger
language plpgsql
security invoker
as $$
declare
  v_old_metric_id int := experiment_metric_name_id(old.metric);
  v_new_metric_id int := experiment_metric_name_id(new.metric);
begin
  perform experiment_metric_point_remove(old.experiment_id, v_old_metric_id, old.step);

  insert into experiment_metric_points (experiment_id, user_id, value, wall_time, metric_id, step)
  values (
    new.experiment_id,
    coalesce(new.user_id, old.user_id, auth.uid()),
    new.value,
    new.wall_time,
    v_new_metric_id,
    coalesce(new.step, old.step)
  )
  on conflict (experiment_id, metric_id, step)
  do update set value = excluded.value, wall_time = excluded.wall_time;

  return new;
end;
$$;

drop trigger if exists experiment_metrics_update_trg on experiment_metrics;
create trigger experiment_metrics_update_trg
  instead of update on experiment_metrics
  for each row execute function experiment_metrics_update();

create or replace function experiment_metrics_delete()
returns trigger
language plpgsql
security invoker
as $$
begin
  perform experiment_metric_point_remove(
    old.experiment_id, experiment_metric_name_id(old.metric), old.step);
  return old;
end;
$$;

drop trigger if exists experiment_metrics_delete_trg on experiment_metrics;
create trigger experiment_metrics_delete_trg
  instead of delete on experiment_metrics
  for each row execute function experiment_metrics_delete();

-- ---------------------------------------------------------------------------
-- Rollup.
-- ---------------------------------------------------------------------------

/**
 * Move settled points out of the row store and into chunks.
 *
 * `p_hot_tail` points per series are left behind: those are the ones still
 * likely to be rewritten by a re-ingest or by the downsampler replacing an
 * off-grid tip, and a row absorbs that far more cheaply than rewriting an array.
 *
 * Chunks are numbered from whatever the series has already used, so running
 * this repeatedly appends rather than colliding. Points are packed in step
 * order; a point that arrives late enough to be older than an existing chunk
 * simply lands in a higher-numbered chunk, which costs nothing because every
 * read sorts by step.
 *
 * Returns the number of points archived.
 */
create or replace function experiment_metrics_rollup(
  p_chunk_size int default 250,
  p_hot_tail   int default 250
)
returns bigint
language plpgsql
security invoker
as $$
declare
  v_series record;
  v_archived bigint := 0;
  v_next_chunk int;
  v_sealed int;
  v_removed int;
begin
  if p_chunk_size < 1 then
    raise exception 'chunk size must be positive';
  end if;

  for v_series in
    select experiment_id, metric_id, user_id, count(*) as n
      from experiment_metric_points
     group by experiment_id, metric_id, user_id
    having count(*) > p_hot_tail + p_chunk_size
  loop
    select coalesce(max(chunk_no) + 1, 0) into v_next_chunk
      from experiment_metric_chunks
     where experiment_id = v_series.experiment_id
       and metric_id     = v_series.metric_id;

    with settled as (
      -- Oldest first, holding back the hot tail.
      select step, value, wall_time
        from experiment_metric_points
       where experiment_id = v_series.experiment_id
         and metric_id     = v_series.metric_id
       order by step
       limit greatest(v_series.n - p_hot_tail, 0)
    ),
    numbered as (
      select step, value, wall_time,
             ((row_number() over (order by step)) - 1) / p_chunk_size as bucket
        from settled
    ),
    packed as (
      select bucket,
             array_agg(step order by step)      as steps,
             array_agg(value order by step)     as values,
             array_agg(wall_time order by step) as wall_times
        from numbered
       group by bucket
        -- Never seal a partial chunk: the leftover stays in the row store and
        -- is picked up by a later pass once it has grown to a full chunk.
        having count(*) = p_chunk_size
    )
    insert into experiment_metric_chunks
      (experiment_id, user_id, metric_id, chunk_no, steps, values, wall_times)
    select v_series.experiment_id, v_series.user_id, v_series.metric_id,
           v_next_chunk + bucket, steps, values, wall_times
      from packed;

    get diagnostics v_sealed = row_count;
    continue when v_sealed = 0;

    -- Remove exactly what was archived, identified by the chunks just written.
    delete from experiment_metric_points p
     where p.experiment_id = v_series.experiment_id
       and p.metric_id     = v_series.metric_id
       and p.step in (
         select unnest(c.steps) from experiment_metric_chunks c
          where c.experiment_id = v_series.experiment_id
            and c.metric_id     = v_series.metric_id
            and c.chunk_no     >= v_next_chunk
       );

    get diagnostics v_removed = row_count;
    v_archived := v_archived + v_removed;
  end loop;

  return v_archived;
end;
$$;

revoke all on function experiment_metrics_rollup(int, int) from public;
grant execute on function experiment_metrics_rollup(int, int) to service_role;
