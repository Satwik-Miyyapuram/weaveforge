-- Per-user appearance preferences (light/dark mode + theme variants).

alter table user_settings
  add column if not exists appearance jsonb;
