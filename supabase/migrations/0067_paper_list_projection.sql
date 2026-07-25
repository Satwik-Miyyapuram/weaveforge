-- Store a small encrypted projection for paper cards.
-- The projection uses the paper resource DEK and remains ciphertext at rest.
alter table papers
  add column if not exists list_content_enc text,
  add column if not exists list_enc_epoch int;

comment on column papers.list_content_enc is
  'E2EE card projection containing only title and authors; populated by the client.';
