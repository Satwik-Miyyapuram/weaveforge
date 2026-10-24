-- Migration: fix three ways the metric chunk archive (0115) loses or duplicates
-- points, and stop the activity read (0131) expanding every chunk.
--
-- ## 1. Deleting a point cut the wrong step (review 40-02)
--
-- `experiment_metric_point_remove` took the step's position from one chunk
-- (`limit 1`) and cut that position out of every chunk holding the step. A step
-- can sit in two chunks (see 3), at different positions, so the second chunk
-- lost a neighbouring point instead and kept the one asked for. The position is
-- now taken per chunk.
--
-- ## 2. Deleting the last point of a chunk failed (review 40-04)
--
-- Cutting the only element left empty arrays, which the chunk's length check
-- (`cardinality(steps) > 0`) rejects with 23514 before the "delete emptied
-- chunks" statement after it could run. So deleting or updating that point
-- failed outright. A chunk whose only step is the one removed is now deleted
-- instead of cut.
--
-- ## 3. Re-archiving a step left the old copy behind (review 40-03)
--
-- A late write for an archived step lands in the row store, and the next rollup
-- archives it again into a new chunk without removing it from the old one. The
-- view still shows the right value while the row exists, but once both copies
-- are in chunks it picks either. Each rollup now removes the steps it just
-- archived from the series' older chunks (`experiment_metric_chunks_supersede`),
-- and existing duplicates are cleared once below, keeping each step's newest
-- chunk: the one written last, which is the value the view showed.
--
-- ## 4. The activity read expanded every chunk (review 40-11)
--
-- `latest_metric_activity` unnested every chunk's `wall_times` to find one
-- maximum per experiment. Each chunk now stores its own newest wall time,
-- kept by a trigger, and the read takes the maximum of those.
--
-- Reversal: db/migrations-rollback/0144_metric_chunk_fixes.sql
--
-- Re-runnable: every statement is guarded or idempotent.

-- ---------------------------------------------------------------------------
-- 1 and 2. Remove one point from wherever it lives.
-- ---------------------------------------------------------------------------

create or replace function experiment_metric_point_remove(
  p_experiment_id uuid,
  p_metric_id int,
  p_step int
)
returns void
language plpgsql
security invoker
as $$
begin
  delete from experiment_metric_points
   where experiment_id = p_experiment_id
     and metric_id     = p_metric_id
     and step          = p_step;

  -- The length check forbids empty arrays, so a chunk holding only this step
  -- goes rather than being cut.
  delete from experiment_metric_chunks
   where experiment_id = p_experiment_id
     and metric_id     = p_metric_id
     and steps = array[p_step];

  -- Every other chunk holding the step is cut at its own position.
  update experiment_metric_chunks c
     set steps      = c.steps[:x.pos-1]      || c.steps[x.pos+1:],
         values     = c.values[:x.pos-1]     || c.values[x.pos+1:],
         wall_times = c.wall_times[:x.pos-1] || c.wall_times[x.pos+1:]
    from (
      select chunk_no, array_position(steps, p_step) as pos
        from experiment_metric_chunks
       where experiment_id = p_experiment_id
         and metric_id     = p_metric_id
         and p_step = any(steps)
    ) x
   where c.experiment_id = p_experiment_id
     and c.metric_id     = p_metric_id
     and c.chunk_no      = x.chunk_no;
end;
$$;

revoke all on function experiment_metric_point_remove(uuid, int, int) from public;
grant execute on function experiment_metric_point_remove(uuid, int, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. One archived copy per step.
-- ---------------------------------------------------------------------------

/**
 * Remove from a series' chunks numbered below `p_from_chunk` every step that a
 * chunk numbered `p_from_chunk` or above also holds. Higher numbers were
 * written later, so they hold the newer value.
 */
create or replace function experiment_metric_chunks_supersede(
  p_experiment_id uuid,
  p_metric_id int,
  p_from_chunk int
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_newer int[];
begin
  select array_agg(s) into v_newer
    from experiment_metric_chunks c, unnest(c.steps) as s
   where c.experiment_id = p_experiment_id
     and c.metric_id     = p_metric_id
     and c.chunk_no     >= p_from_chunk;

  if v_newer is null then
    return;
  end if;

  delete from experiment_metric_chunks
   where experiment_id = p_experiment_id
     and metric_id     = p_metric_id
     and chunk_no      < p_from_chunk
     and steps <@ v_newer;

  update experiment_metric_chunks c
     set (steps, values, wall_times) = (
           select array_agg(u.s order by u.i),
                  array_agg(u.v order by u.i),
                  array_agg(u.w order by u.i)
             from unnest(c.steps, c.values, c.wall_times) with ordinality as u(s, v, w, i)
            where u.s <> all(v_newer))
   where c.experiment_id = p_experiment_id
     and c.metric_id     = p_metric_id
     and c.chunk_no      < p_from_chunk
     and c.steps && v_newer;
end;
$$;

revoke all on function experiment_metric_chunks_supersede(uuid, int, int) from public;
revoke all on function experiment_metric_chunks_supersede(uuid, int, int) from anon, authenticated;
grant execute on function experiment_metric_chunks_supersede(uuid, int, int) to service_role;

/**
 * Clear duplicates the old rollup already wrote: each step stays only in the
 * highest-numbered chunk holding it. Run once below; safe to run again.
 */
create or replace function experiment_metric_chunks_dedupe()
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_series record;
  v_chunk int;
begin
  for v_series in
    select distinct c.experiment_id, c.metric_id
      from experiment_metric_chunks c, unnest(c.steps) as s
     group by c.experiment_id, c.metric_id, s
    having count(*) > 1
  loop
    -- Newest first, so each pass only has to look above itself.
    for v_chunk in
      select chunk_no from experiment_metric_chunks
       where experiment_id = v_series.experiment_id
         and metric_id     = v_series.metric_id
       order by chunk_no desc
    loop
      perform experiment_metric_chunks_supersede(
        v_series.experiment_id, v_series.metric_id, v_chunk);
    end loop;
  end loop;
end;
$$;

revoke all on function experiment_metric_chunks_dedupe() from public;
revoke all on function experiment_metric_chunks_dedupe() from anon, authenticated;
grant execute on function experiment_metric_chunks_dedupe() to service_role;

-- Same body as 0115 apart from the supersede call after sealing.
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
      having count(*) = p_chunk_size
    )
    insert into experiment_metric_chunks
      (experiment_id, user_id, metric_id, chunk_no, steps, values, wall_times)
    select v_series.experiment_id, v_series.user_id, v_series.metric_id,
           v_next_chunk + bucket, steps, values, wall_times
      from packed;

    get diagnostics v_sealed = row_count;
    continue when v_sealed = 0;

    -- A re-ingested step just archived again replaces its older archived copy.
    perform experiment_metric_chunks_supersede(
      v_series.experiment_id, v_series.metric_id, v_next_chunk);

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

select experiment_metric_chunks_dedupe();

-- ---------------------------------------------------------------------------
-- 4. Each chunk's newest wall time.
-- ---------------------------------------------------------------------------

-- Nullable with no default: adding it rewrites nothing.
alter table experiment_metric_chunks add column if not exists max_wall_time timestamptz;

create or replace function experiment_metric_chunks_max_wall_time()
returns trigger
language plpgsql
as $$
begin
  new.max_wall_time := (select max(w) from unnest(new.wall_times) as w);
  return new;
end;
$$;

drop trigger if exists experiment_metric_chunks_max_wall_time_trg on experiment_metric_chunks;
create trigger experiment_metric_chunks_max_wall_time_trg
  before insert or update of wall_times on experiment_metric_chunks
  for each row execute function experiment_metric_chunks_max_wall_time();

update experiment_metric_chunks
   set max_wall_time = (select max(w) from unnest(wall_times) as w)
 where max_wall_time is distinct from (select max(w) from unnest(wall_times) as w);

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
      select c.experiment_id, max(c.max_wall_time) as last_wall_time
        from experiment_metric_chunks c
       where c.experiment_id = any(p_experiment_ids)
       group by c.experiment_id
    ) as chunks on chunks.experiment_id = ids.experiment_id
   where greatest(points.last_wall_time, chunks.last_wall_time) is not null;
$$;

revoke all on function latest_metric_activity(uuid[]) from public;
revoke all on function latest_metric_activity(uuid[]) from anon;
grant execute on function latest_metric_activity(uuid[]) to authenticated, service_role;
