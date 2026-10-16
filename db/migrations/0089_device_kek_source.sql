-- Allow random browser-device secrets to wrap the user master key.
-- The secret is generated and retained only by the user's browser; it is
-- never derived from a Google/email identity or sent to the server.

alter table user_keys
  drop constraint if exists user_keys_kek_source_check;

alter table user_keys
  add constraint user_keys_kek_source_check
  check (kek_source in ('passphrase', 'login-password', 'device'));
