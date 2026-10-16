-- Post-migration cleanup (plan §6 migration 0045).
-- Run only after all users have migrated to E2EE (content_enc populated).

-- Example (disabled until soak complete):
-- drop index if exists papers_user_doi_uniq;
-- drop index if exists papers_user_arxiv_uniq;
-- alter table vault_pages alter column title set default '';
-- alter table papers alter column title set default '';

comment on column vault_pages.content_enc is 'E2EE JSON bag; legacy title/body become sentinels after migration.';
