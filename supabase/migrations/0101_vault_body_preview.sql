-- Card projection for notes: short body prefix without shipping full markdown
-- on every listSummaries() call. Full body still loads via getById on open.
alter table vault_pages
  add column if not exists body_preview text
  generated always as (left(coalesce(body, ''), 320)) stored;

comment on column vault_pages.body_preview is
  'Truncated plaintext for note cards; full body is loaded on open.';
