-- Metric points the desktop SDK API wrote here, carried to the server afterwards.
--
-- Metrics are not in the change feed, so a pump sends them; this is how far it
-- got per series. A run whose metrics were cleared is listed in the resets so
-- the server copy is cleared too before the new points go.
create table if not exists public.local_metric_pushes (
  experiment_id uuid not null,
  metric text not null,
  step integer not null,
  primary key (experiment_id, metric)
);

create table if not exists public.local_metric_resets (
  experiment_id uuid primary key,
  queued_at timestamptz not null default now()
);
