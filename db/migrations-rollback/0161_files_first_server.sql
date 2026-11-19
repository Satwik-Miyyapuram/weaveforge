-- Undo 0161 — drops the files-first server tables and RPCs.
--
-- Deletes all grants, shared docs and inbox rows. Order matters:
-- sdk_inbox_claim() returns rows of sdk_inbox, so it goes before that table;
-- the shared_docs_read policy uses shared_doc_access(), so that function goes
-- after shared_docs. Safe to run more than once.

drop function if exists sdk_inbox_claim(bigint, text, int);
drop table if exists sdk_inbox;
drop table if exists shared_docs;
drop table if exists grants;

drop function if exists revoke_grant(uuid, uuid);
drop function if exists shared_doc_restore(text, text, bytea);
drop function if exists shared_doc_access(text, uuid);
drop function if exists shared_docs_touch();

notify pgrst, 'reload schema';
