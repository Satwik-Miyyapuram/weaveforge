# Vault core module

The `vault` module holds the rules for notes: wikilink rewrites, the note
template engine with its editable and generated regions, vault page text
offsets, the row shape of a page in the database, import rules, and the template
context for a paper's source note. The rules are pure. The app reads and writes
the pages, the files and the database.

## What lives in Rust

- `page.rs`: vault page text rules. Offsets and lengths are UTF-16 code units,
  as JavaScript counts them. Code masking replaces each match with spaces of the
  same UTF-16 length, so the offsets of the input stay valid.
- `page_row.rs`: maps a vault page to and from the `vault_pages` table row. Every
  backend reads and writes the same table, so the mapping lives here once.
- `template.rs`: the note template engine. Templates use `{{var}}` substitution
  and HTML-comment region markers. Generated regions refresh on re-render;
  editable regions and unmarked text are kept byte for byte. Damaged markers keep
  the existing document unchanged.
- `import_links.rs`: which files a notes import reads, and the wikilink rewrites
  after a title is auto-suffixed.
- `source_note_context.rs`: the template context for a paper's source note,
  built from the paper's metadata.
- `mod.rs`: the module head and the re-exports.

## How the app calls it

The wasm exports live in `crates/wf-wasm/src`. The TypeScript wrappers in
`packages/wf-wasm/src` import the raw names from `../pkg/wf_wasm.js` and
re-export them. The main names are `rewriteWikilinks`, `isNoteImportFile`,
`vaultPageToDomain`, `vaultPageToRow`, `vaultPageToSummaryDomain`,
`sourceNoteTemplateContext`, `renderTemplate`, `mergeTemplate`, `applyTemplate`,
`parseRegions`, `wrapRegion`, `stripRegionMarkers`, `substituteVariables`,
`defaultSourceNoteTemplate`, `normalizeTitleKey`, `uniqueTitle`,
`extractWikilinks`, `noteBacklinks` and `expandEmbeds`.

Code in `apps/web` reads these through `readyCore()` or `typedCore()` from
`apps/web/src/lib/rust-core.ts`. Examples:

- `apps/web/src/features/vault/application/import-notes.ts` calls
  `readyCore().rewriteWikilinks`.
- `apps/web/src/features/vault/infrastructure/postgrest-vault-page-repository.ts`
  calls `typedCore().vaultPageToDomain` and `typedCore().vaultPageToRow`.
- `apps/web/src/features/vault/ui/vault-screen/vault-screen.tsx` and
  `page-editor.tsx` call the template and wikilink functions.

## What stays in TypeScript, and why

- **Database I/O.** Reading and writing `vault_pages` through PostgREST stays in
  `apps/web/src/features/vault/infrastructure`. Rust maps rows; it does not query.
- **File reads for import.** The app reads the files a notes import selects.
  `import_links.rs` decides which ones to read.
- **The editor and the screens.** The editor, the vault screens and the dialogs
  stay in `apps/web/src/features/vault/ui`.
- **Known template divergences.** Numbers print with Rust's `Display`, so
  exponent forms such as `1e21` and `1e-7` differ from JavaScript's `String(n)`.
  Dotted paths index arrays by numeric position only. Both are recorded in the
  module head.

## Related

- [Workspace core](workspace.md)
- [Search core](search.md)
- [Storage core](storage.md)

Source: `crates/wf-core/src/vault/`
