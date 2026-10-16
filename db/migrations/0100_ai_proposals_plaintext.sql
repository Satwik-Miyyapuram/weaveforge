-- AI proposals / audit: plaintext content jsonb (tables empty — no backfill).
-- Replaces content_enc + enc_epoch; RLS remains the access boundary.

alter table ai_proposals
  add column if not exists content jsonb;

alter table ai_audit_records
  add column if not exists content jsonb;

alter table ai_proposals
  drop column if exists content_enc,
  drop column if exists enc_epoch;

alter table ai_audit_records
  drop column if exists content_enc,
  drop column if exists enc_epoch;

alter table ai_proposals
  alter column content set not null;

alter table ai_audit_records
  alter column content set not null;

comment on table ai_proposals is 'AI proposals. Payload and sources are plaintext jsonb in content (RLS + at-rest).';
comment on table ai_audit_records is 'Immutable AI action audit records. Details are plaintext jsonb in content (RLS + at-rest).';
