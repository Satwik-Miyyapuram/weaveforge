-- Migration: provider-keyed integration credentials on user_settings
-- Complements legacy flat columns (zotero_api_key, …) for the integrations bag.

alter table user_settings
  add column if not exists integrations jsonb;
