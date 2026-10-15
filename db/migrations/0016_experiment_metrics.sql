-- Migration: experiment_metrics (step-indexed metric history / training curves).
-- One row per (experiment, metric, step) sample, so TensorBoard / wandb curves
-- pushed by the Python SDK survive as full time-series — not just the flat
-- summary in `experiments.metrics`. Owned by the `experiments` feature module.

create extension if not exists "pgcrypto";

create table if not exists experiment_metrics (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) default auth.uid(),
  experiment_id uuid not null references experiments(id) on delete cascade,
  metric        text not null,
  step          int not null default 0,
  value         double precision not null,
  wall_time     timestamptz,
  created_at    timestamptz not null default now()
);

-- Reading a curve = all points of one metric for one experiment, in step order.
create index if not exists experiment_metrics_series_idx
  on experiment_metrics (experiment_id, metric, step);

alter table experiment_metrics enable row level security;
drop policy if exists "experiment_metrics_select_own" on experiment_metrics;
create policy "experiment_metrics_select_own" on experiment_metrics
  for select using (auth.uid() = user_id);
drop policy if exists "experiment_metrics_modify_own" on experiment_metrics;
create policy "experiment_metrics_modify_own" on experiment_metrics
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
