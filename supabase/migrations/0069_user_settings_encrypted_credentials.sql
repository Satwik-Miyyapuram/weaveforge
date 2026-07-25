-- Reusable third-party credentials are encrypted in the unlocked browser with
-- the user's E2EE master key. This column holds only a base64url ciphertext
-- envelope; it never contains plaintext API keys or provider token JSON.
--
-- Existing plaintext values are migrated client-side after the user unlocks
-- encryption. A SQL migration cannot safely encrypt them because the database
-- never has access to the user's master key.
alter table user_settings
  add column if not exists credentials_enc text;

comment on column user_settings.credentials_enc is
  'Client-side encrypted integration credentials, bound to the owning user by AEAD additional authenticated data.';

comment on column user_settings.zotero_api_key is
  'Deprecated plaintext legacy field. Cleared by the client after E2EE credential migration.';

comment on column user_settings.semantic_scholar_key is
  'Deprecated plaintext legacy field. Cleared by the client after E2EE credential migration.';

comment on column user_settings.integrations is
  'Deprecated plaintext legacy credential bag. Cleared by the client after E2EE credential migration.';
