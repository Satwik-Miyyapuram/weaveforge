-- Migration: per-project Zotero collection.
-- The Zotero API key + library live in user_settings (per user, one library).
-- Each project maps to a collection inside that library, stored here.

alter table projects add column if not exists zotero_collection text;
