-- Encrypted email-recovery wrapper. The email link carries only the random
-- client-generated secret; the database stores the encrypted UMK wrapper.
alter table user_keys
  add column if not exists email_recovery_kdf_params jsonb,
  add column if not exists umk_wrapped_email_recovery bytea,
  add column if not exists email_recovery_setup_at timestamptz;

comment on column user_keys.email_recovery_kdf_params is
  'Argon2id parameters for the random email-link recovery secret; secret never stored.';
comment on column user_keys.umk_wrapped_email_recovery is
  'Encrypted UMK wrapper derived from the random email-link recovery secret.';
comment on column user_keys.email_recovery_setup_at is
  'Timestamp when email recovery was last configured; configuring again rotates the link secret.';
