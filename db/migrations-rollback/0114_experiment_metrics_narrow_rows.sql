-- Undo 0114 — put `experiment_metrics` back as a plain table with `metric text`.
--
-- Restores the shape, not the bytes: `id` values are freshly minted and
-- `created_at` is set to `now()`, because 0114 deleted the originals on purpose.
-- Rows it deduplicated stay gone; they were exact copies of rows that remain.
--
-- Safe to run more than once, and a no-op if 0114 was never applied.

do $$
begin
  if to_regclass('public.experiment_metric_points') is null then
    return;                                  -- 0114 not applied
  end if;

  drop trigger if exists experiment_metrics_insert_trg on experiment_metrics;
  drop trigger if exists experiment_metrics_update_trg on experiment_metrics;
  drop trigger if exists experiment_metrics_delete_trg on experiment_metrics;
  drop view if exists experiment_metrics;

  alter table experiment_metric_points rename to experiment_metrics;
  alter index experiment_metric_points_pkey rename to experiment_metrics_pkey;
  alter index if exists experiment_metric_points_user_id_idx rename to experiment_metrics_user_id_idx;

  alter table experiment_metrics
    drop constraint if exists experiment_metrics_metric_id_fkey;

  alter table experiment_metrics add column if not exists metric text;
  update experiment_metrics m
     set metric = n.name
    from experiment_metric_names n
   where n.id = m.metric_id and m.metric is distinct from n.name;
  alter table experiment_metrics alter column metric set not null;

  alter table experiment_metrics
    drop constraint if exists experiment_metrics_pkey,
    drop column if exists metric_id;

  alter table experiment_metrics
    add column if not exists id uuid not null default gen_random_uuid(),
    add column if not exists created_at timestamptz not null default now();

  alter table experiment_metrics add constraint experiment_metrics_pkey primary key (id);

  create index if not exists experiment_metrics_series_idx
    on experiment_metrics (experiment_id, metric, step);
end;
$$;

drop function if exists experiment_metrics_insert();
drop function if exists experiment_metrics_update();
drop function if exists experiment_metrics_delete();

-- `experiment_metric_names` and `experiment_metric_name_id()` are left in place:
-- 0115's chunk table keys on `metric_id` too, so dropping them here would break
-- a database that still has Fix B applied. They cost a handful of rows.
