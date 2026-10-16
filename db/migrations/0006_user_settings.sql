-- Migration: user_settings (per-user preferences + third-party credentials)
-- One row per user, keyed by user_id. RLS isolates each user's own row.
-- Owned by the `settings` feature module.
--
-- NOTE: credentials (e.g. Zotero API key) are stored as plain text, protected
-- by Row-Level Security. Adequate for a personal single-user tool; not a vault.

create table if not exists user_settings (
  user_id              uuid primary key references auth.users(id) default auth.uid(),
  zotero_api_key       text,
  zotero_library       text,
  semantic_scholar_key text,
  updated_at           timestamptz not null default now()
);

alter table user_settings enable row level security;

drop policy if exists "user_settings_select_own" on user_settings;
create policy "user_settings_select_own" on user_settings
  for select using (auth.uid() = user_id);

drop policy if exists "user_settings_modify_own" on user_settings;
create policy "user_settings_modify_own" on user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
