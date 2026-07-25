-- Per-project graph view settings (filters, layout prefs, pinned nodes), stored as JSON.

alter table projects
  add column if not exists graph_settings jsonb;
