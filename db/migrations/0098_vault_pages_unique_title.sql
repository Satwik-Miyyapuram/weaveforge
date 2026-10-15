-- Hybrid Phase A: vault page titles are now plaintext, so we can enforce the
-- case-insensitive uniqueness the wikilink resolver relies on ([[Title]] must
-- map to exactly one note). Scoped per project (a title may repeat across
-- projects). Backfill of plaintext titles ran before this via scripts/hybrid-backfill.ts.

create unique index if not exists vault_pages_project_lower_title_uidx
  on vault_pages (project_id, lower(title));
