-- Vault E2EE pilot: encrypted content bag column (plan §6 migration 0041 vault slice).

alter table vault_pages
  add column if not exists content_enc text,
  add column if not exists enc_epoch int;
