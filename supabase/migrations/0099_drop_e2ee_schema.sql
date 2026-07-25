-- ============================================================================
-- Phase 5 — drop the client-E2EE schema (IRREVERSIBLE).
--
-- Client-side E2EE was dropped (CRYPTO_ENABLED=false); data is now stored with
-- provider at-rest encryption and access is governed by RLS. The per-row
-- ciphertext columns and the key-material tables are no longer read or written
-- by the app (see the encrypted-row helpers, which no-op when crypto is off).
--
-- A targeted backup of everything removed here was taken before applying
-- (scripts/phase5-backup.mjs -> backups/phase5-e2ee-backup-*.json). Restoring
-- E2EE requires re-adding these columns/tables and reloading from that backup.
--
-- ai_audit_records / ai_proposals are DELIBERATELY EXCLUDED — they use a
-- separate envelope cipher (UserBoundEnvelopeCrypto), not this schema.
--
-- All statements use IF EXISTS, so this migration is safe to re-run.
-- ============================================================================

begin;

-- 1. Drop the per-row ciphertext bags from the backfilled entity tables.
alter table public.vault_pages        drop column if exists content_enc, drop column if exists enc_epoch;
alter table public.papers             drop column if exists content_enc, drop column if exists enc_epoch,
                                       drop column if exists list_content_enc, drop column if exists list_enc_epoch;
alter table public.report_sections    drop column if exists content_enc, drop column if exists enc_epoch;
alter table public.reading_lists      drop column if exists content_enc, drop column if exists enc_epoch;
alter table public.reading_list_items drop column if exists content_enc, drop column if exists enc_epoch;
alter table public.experiments        drop column if exists content_enc, drop column if exists enc_epoch;
alter table public.milestones         drop column if exists content_enc, drop column if exists enc_epoch;
alter table public.log_entries        drop column if exists content_enc, drop column if exists enc_epoch;
alter table public.comments           drop column if exists content_enc, drop column if exists enc_epoch;

-- 2. Drop the key material tables. CASCADE clears the wrap->key FKs in any order.
drop table if exists public.resource_key_wraps            cascade;
drop table if exists public.resource_keys                 cascade;
drop table if exists public.project_key_wraps             cascade;
drop table if exists public.project_keys                  cascade;
drop table if exists public.key_epochs                    cascade;
drop table if exists public.user_device_key_wraps         cascade;
drop table if exists public.user_device_transfer_requests cascade;
drop table if exists public.user_email_recovery_secrets   cascade;
drop table if exists public.user_keys                     cascade;

commit;
