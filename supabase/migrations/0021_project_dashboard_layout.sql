-- Per-project dashboard widget layout (drag/resize grid), stored as JSON.

alter table projects
  add column if not exists dashboard_layout jsonb;
