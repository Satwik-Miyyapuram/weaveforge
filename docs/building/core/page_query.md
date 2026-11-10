# page_query

Source: `crates/wf-core/src/vault/page_query.rs`. Wasm: `crates/wf-wasm/src/vault_page_query.rs`
(exports `vaultTitleOrBodyFilter`, `vaultTitleLikePattern`, `isMissingBodyPreviewColumn`).
TS: `packages/wf-wasm/src/vault-page.ts`, used by `apps/web/src/features/vault/infrastructure/postgrest-vault-page-repository.ts`.

## Rules

- `escape_like`: `\`, `%` and `_` get a leading `\`, so they match themselves in LIKE.
- `title_or_body_filter(query)`: two escapes, in order. LIKE first, then PostgREST's double-quoted
  value (`\` and `"`). Returns `None` for an empty query, which means no filter.
- `title_like_pattern(key)`: escape each space-separated word of a normalised title key and join
  with `%`, because whitespace runs may differ in the stored title. The exact title rule still runs in TS.
- `is_missing_body_preview_column(message, code)`: true when the message mentions `body_preview`
  and either says `column` or the code is `42703`. Used to fall back before the column is migrated.

## Stays in TS

The PostgREST calls, the fallbacks that re-query without `body_preview`, and the row-to-domain
mapping (already in `vault::page_row`).
