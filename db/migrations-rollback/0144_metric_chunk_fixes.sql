-- Undo 0144 — restore the 0115 point removal and rollup and the 0131 activity
-- read, and drop the per-chunk wall time and the two chunk helpers.
--
-- Lossless for data still in the database: the column and trigger are derived
-- from `wall_times`. Duplicate archived copies cleared by 0144 do not come back;
-- each was an older copy of a step whose newer copy is kept. Reverting brings
-- back the bugs 0144 fixed: deleting a step held by two chunks can cut a
-- neighbour, deleting a chunk's last point fails, and re-archiving duplicates.
--
-- Safe to run more than once.

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

drop trigger if exists experiment_metric_chunks_max_wall_time_trg on experiment_metric_chunks;
drop function if exists experiment_metric_chunks_max_wall_time();
alter table experiment_metric_chunks drop column if exists max_wall_time;

drop function if exists experiment_metric_chunks_dedupe();
drop function if exists experiment_metric_chunks_supersede(uuid, int, int);
