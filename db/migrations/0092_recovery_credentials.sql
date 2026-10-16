-- User-created recovery passphrase and setup metadata.
-- The passphrase wrapper and recovery-code wrapper contain the same UMK but
-- are independently encrypted. No passphrase or recovery code is stored.

alter table user_keys
  add column if not exists passphrase_kdf_params jsonb,
  add column if not exists umk_wrapped_passphrase bytea,
  add column if not exists recovery_setup_at timestamptz;

comment on column user_keys.passphrase_kdf_params is
  'Argon2id parameters for the user-created recovery passphrase; secret never stored.';
comment on column user_keys.umk_wrapped_passphrase is
  'Encrypted UMK wrapper derived from the user-created recovery passphrase.';
comment on column user_keys.recovery_setup_at is
  'Timestamp when the user-created recovery passphrase and recovery code were configured.';
