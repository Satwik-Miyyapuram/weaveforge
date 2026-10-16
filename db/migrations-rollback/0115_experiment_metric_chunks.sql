-- Undo 0115 — expand every chunk back into rows and drop the chunk table.
--
-- Lossless: chunks only ever hold points that were rows before the rollup moved
-- them, so putting them back restores exactly the same measurements. The view
-- returns to reading `experiment_metric_points` alone, as 0114 left it.
--
-- Safe to run more than once, and a no-op if 0115 was never applied.

do $$
begin
  if to_regclass('public.experiment_metric_chunks') is null then
    return;                                  -- 0115 not applied
  end if;

  -- A step can exist in both stores; the loose row is the newer one, so it
  -- wins. Same precedence the 0115 view used.
  insert into experiment_metric_points (experiment_id, user_id, value, wall_time, metric_id, step)
  select c.experiment_id, c.user_id, u.value, u.wall_time, c.metric_id, u.step
    from experiment_metric_chunks c
    cross join lateral unnest(c.steps, c.values, c.wall_times) as u(step, value, wall_time)
  on conflict (experiment_id, metric_id, step) do nothing;
end;
$$;

drop function if exists experiment_metrics_rollup(int, int);

-- Back to 0114's view and its triggers.
--
-- Order matters: the view still reads `experiment_metric_chunks`, so the table
-- cannot be dropped until the view has stopped referring to it. Dropping first
-- fails with "other objects depend on it" — which is how a rehearsal caught
-- this, rather than a production rollback discovering it mid-incident.
create or replace view experiment_metrics
  with (security_invoker = true)
as
  select p.user_id,
         p.experiment_id,
         n.name as metric,
         p.step,
         p.value,
         p.wall_time
    from experiment_metric_points p
    join experiment_metric_names n on n.id = p.metric_id;

grant select, insert, update, delete on experiment_metrics to authenticated;
grant select, insert, update, delete on experiment_metrics to service_role;

create or replace function experiment_metrics_delete()
returns trigger
language plpgsql
security invoker
as $$
begin
  delete from experiment_metric_points
   where experiment_id = old.experiment_id
     and metric_id     = experiment_metric_name_id(old.metric)
     and step          = old.step;
  return old;
end;
$$;

drop trigger if exists experiment_metrics_insert_trg on experiment_metrics;
create trigger experiment_metrics_insert_trg
  instead of insert on experiment_metrics
  for each row execute function experiment_metrics_insert();

drop trigger if exists experiment_metrics_update_trg on experiment_metrics;
create trigger experiment_metrics_update_trg
  instead of update on experiment_metrics
  for each row execute function experiment_metrics_update();

drop trigger if exists experiment_metrics_delete_trg on experiment_metrics;
create trigger experiment_metrics_delete_trg
  instead of delete on experiment_metrics
  for each row execute function experiment_metrics_delete();

-- Now that nothing reads it, the archive can go.
drop table if exists experiment_metric_chunks;
