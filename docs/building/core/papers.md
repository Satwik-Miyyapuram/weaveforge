# Papers core module

The `papers` module holds the pure rules for papers: normalising DOIs, tags and
titles, mapping rows and source responses to paper data, reading open-access and
bibliography sources, and merging or tidying duplicate papers. It does no
fetching and no storage. The app passes data in and gets data out.

## What lives in Rust

Each file under `crates/wf-core/src/papers/` covers one job:

- `mod.rs`: registers the submodules and states the module's scope.
- `paper.rs`: paper status, DOI and tag normalisation, and hashtag reading.
- `paper_title.rs`: placeholder titles, titles read from file names, and match keys.
- `paper_field.rs`: custom paper-field kinds and the rollup config in field options.
- `paper_field_row.rs`: maps paper-field rows to and from the table columns.
- `paper_row.rs`: maps `papers` table rows to and from the paper domain.
- `paper_ref.rs`: decides what a pasted paper reference really is.
- `paper_image.rs`: names the thumbnail variant stored beside a figure's full image.
- `paper_preview.rs`: the preview frame on a paper page and where it leads.
- `paper_drop.rs`: which dropped files count as PDFs or BibTeX, the title read from a PDF, the 200 MiB size cap (`is_pdf_too_large`), and the `arXiv:` stamp in a PDF's first page (`arxiv_stamp`). `split_paper_drop` routes each dropped name to its PDF or BibTeX list, as indices into the drop (`splitPaperDrop`).
- `paper_merge.rs`: merges a duplicate paper into the copy that is kept.
- `library_tidy.rs`: tidies a library imported before the import rules were stricter.
- `bib_import.rs`: imports papers from `.bib` exports of Zotero, Mendeley, Google Scholar and Paperpile.
- `metadata_mapping.rs`: maps Crossref, Semantic Scholar, OpenAlex and arXiv responses to metadata.
- `page_metadata.rs`: reads citation tags, Dublin Core, JSON-LD and OpenGraph from a web page.
- `url_meta.rs`: the relay target for a pasted web address and the messages for a failed read in the desktop shell (`urlMetaShellTarget`, `urlMetaReadFailureMessage`). See [url-meta.md](url-meta.md).
- `open_access.rs`: parses each index's open-access answer and ranks the copies.
- `related_paper_hit.rs`: maps Semantic Scholar and OpenAlex related-paper results.
- `related_paper_url.rs`: picks the page a related-paper hit links to.
- `js_regex.rs`: compiles JS-style patterns with `regex-lite`, so they match as the TypeScript twin does.
- `zotero_mapping.rs`: maps Zotero items to papers and back.
- `zotero_library.rs`: builds Zotero Web API library paths and tests for child items.
- `zotero_annotations.rs`: maps Zotero annotation and note items, one at a time.
- `zotero_local_status.rs`: reader-facing messages for the local Zotero API.
- `annotation_pin.rs`: stores an annotation pin row and maps it to the domain pin.
- `annotation_quotation_type.rs`: how an annotation is used in writing.
- `annotation_quotation_type_row.rs`: maps quotation-type rows to and from the table.
- `quote_block.rs`: formats quotations as note Markdown.
- `note_tags.rs`: edits hashtags in a paper's note body.
- `reading_digest.rs`: a paper's reader marks as note Markdown, and a day's reading log.
- `reference_text.rs`: formats a paper as an APA reference you can paste.
- `compute_rollup.rs`: computes rollup values from related papers' field values.

## How the app calls it

The wasm exports live in `crates/wf-wasm/src`. The TypeScript wrappers in
`packages/wf-wasm/src` import the raw names from `../pkg/wf_wasm.js` and
re-export them. The main names are:

- Paper rows and identifiers: `normalizeDoi`, `normalizeTags`, `extractHashtags`, `paperToRow`, `paperRowToDomain`.
- New paper rules: `checkNewPaper` (trimmed title required; rating 1 to 5). Used by `createPaper` in `features/papers/domain/paper.ts`.
- Metadata: `openAlexToMetadata`, `crossrefToMetadata`, `semanticScholarToMetadata`, `arxivEntryToMetadata`, `urlMetaToMetadata`.
- Open access: `parseOpenalex`, `parseUnpaywall`, `parseSemanticScholar`, `rankOpenAccessCandidates`, `resolveArxivId`.
- Bibliography import: `planBibImport`, `bibPaperInput`, `citeKeyOf`.
- Duplicates: `titleFixes`, `findDuplicateGroups`, `pickKeeper`, `isConferenceCopy`, `mergePaperInto`.
- Zotero: `zoteroHeaders`, `zoteroArxivId`, `zoteroRemoteToMetadata`, `toZoteroItem`, `zoteroItemKey`, `zoteroPickMainPdf`.
- Notes and quotes: `formatQuoteBlock`, `formatQuoteCiteClipboard`, `highlightsDigest`, `draftReadingLog`.
- Hashtags: `tagToHashtag`, `appendTagHashtags`, `removeHashtagFromBody`.

Code in `apps/web` reads these through `readyCore()` or `typedCore()` from
`apps/web/src/lib/rust-core.ts`, or through the wrappers in `packages/wf-wasm`.
`readyCore()` throws until `loadCore()` has resolved, so call it only after the
core has loaded.

## What stays in TypeScript, and why

- **Fetching from sources.** Calls to Zotero, Crossref, OpenAlex, Semantic
  Scholar, arXiv and Unpaywall stay in TypeScript. Rust maps the responses and
  does not make the requests. The Zotero Web API module says that the fetching
  stays with the caller.
- **Reading files and drops.** The browser reads the dropped file and passes its
  bytes or text in. Rust decides what the file is and what its title is.
- **Storage.** The `papers` table, its PostgREST calls and the image files stay in
  `apps/web` infrastructure. Rust maps rows; it does not query them.
- **Orchestration.** Sync runs, retries, and the order in which a merge, an import
  and a tidy happen stay in TypeScript use cases.
- **Hooks and UI.** React state, the paper page and the import dialogs stay in
  `apps/web`.
- **Thin wrappers.** The files in `packages/wf-wasm/src` only forward to the raw
  exports. They keep no rules of their own.

Source: `crates/wf-core/src/papers/`

## More paper modules

| Module | Rust fn | wasm export | TS caller |
| --- | --- | --- | --- |
| `openalex` | `search_query`, `first_match` | `openAlexSearchQuery`, `openAlexFirstMatch` | `apps/web/src/container/parts.ts` |
| `paper_update` | `clean_title`, `clean_summary`, `clean_image_path`, `clean_pdf_address`, `rating_in_range`, `is_https_address` | `cleanPaperTitle`, `cleanPaperSummary`, `cleanImagePath`, `cleanPdfAddress`, `ratingInRange`, `isHttpsAddress` | `packages/core/src/features/papers/application/update-paper.use-case.ts` |
| `pdf_add_plan` | `plan_pdf_add`, `pdf_lookup_steps` | `planPdfAdd`, `planPdfLookups` | `apps/web/src/features/papers/application/parts-2.ts` |
| `source_requests` | `arxiv_query_url`, `crossref_work_url`, `semantic_scholar_identifier_url`, `semantic_scholar_match_url`, `form_urlencode` | `arxivQueryUrl`, `crossrefWorkUrl`, `semanticScholarIdentifierUrl`, `semanticScholarMatchUrl`; `form_urlencode` native only | `apps/web/src/features/papers/infrastructure/parts.ts`, `apps/web/src/features/papers/infrastructure/parts-2.ts` |
| `zotero_pull` | `join_zotero_pull` | `zoteroPullJoin` | `apps/web/src/features/papers/infrastructure/parts-2.ts` |
| `zotero_sync_plan` | `sync_plan` | `zoteroSyncPlan` | `apps/web/src/features/papers/infrastructure/parts-3.ts` |

Rules:

- `openalex`: the query is `search` and `per-page=3`, then `mailto` and `api_key` when non-empty. `first_match` returns the first work whose title and year match the hints; works with no title are skipped. The HTTP call stays in TS.
- `paper_update`: `clean_title` collapses whitespace; `clean_summary` keeps markdown verbatim and clears when blank. `rating_in_range` accepts 1 to 5, and NaN passes, as the TS check did. `is_https_address` matches `https://` in any letter case.
- `pdf_add_plan`: a lookup match titles the paper; otherwise the PDF's title, else the file name. The dropped PDF is kept when the paper is new or has no PDF yet. `pdf_lookup_steps` tries DOI, then arXiv id, then title, skipping empty ones; offline there are none.
- `source_requests`: builders only; the fetches stay in TypeScript.
- `zotero_pull`: output keeps first-seen order, as the JS `Map`s it replaces did.
- `zotero_sync_plan`: the plan is made once from a snapshot taken before any write, so pull, push and delete read the same state. TS performs only the I/O the plan names.

