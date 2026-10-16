-- Track which privacy disclaimer version the user accepted (re-prompt on bump).

alter table user_settings
  add column if not exists disclaimer_version int;

comment on column user_settings.disclaimer_version is
  'Version of the privacy disclaimer accepted by the user; re-accept when app bumps CURRENT_DISCLAIMER_VERSION.';
