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
- Zotero: `zoteroHeaders`, `zoteroRemoteToMetadata`, `toZoteroItem`.
- Notes and quotes: `formatQuoteBlock`, `formatQuoteCiteClipboard`, `highlightsDigest`, `draftReadingLog`.
- Hashtags: `removeHashtagFromBody`.

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

## Paper files (files-first)

Each paper is one file, `<project>/papers/<title slug>.paper.md` (`-2`, `-3`, … when two
papers share a title). The paper's fields sit in frontmatter (`weaveforge-type: paper`,
then kebab-case keys such as `arxiv-id`, `pdf-path`, `read-at`); the body is the
reader's notes. A paper is identified by its file: its id is the optional
`weaveforge-id` when the file has one, else the file's path. No file name holds an id.

- Rust: `crates/wf-core/src/papers/paper_file.rs`. `parse_paper_file` and
  `render_paper_file` read and write the file; `paper_row` gives the `Paper` row
  (camelCase, no `id` when the file has none); `write_paper_row(existing, row)` writes a
  row into a file, keeping everything the row does not carry. An existing file keeps its
  own id (or none); a new file gets `row.id`, or no id line when the row has none. A CRLF
  file stays CRLF, and text is written as given (no Unicode normalization). A file with
  `wf` above `FORMAT_VERSION` is refused.
- wasm: `paperRowFromFile`, `writePaperRow` (`crates/wf-wasm/src/paper_files.rs`).
- TS: `FilePaperRepository` (`apps/web/src/features/papers/infrastructure/file-paper-repository.ts`)
  implements `IPaperRepository` over `IWorkspaceFs`. Every write is conditional
  (`writeTextIf`); when the file changed since it was read, the write reads again and
  re-applies, up to 3 times, then throws `ConflictError`. A `.paper.md` that is not a
  paper is left out of reads and listed by `failures()`. `writeIds: false` writes no
  id into new files. `delete(id)` moves the paper file, its `x.annotations.json` and
  `x.comments.json` and its PDF to the trash under one day; the PDF stays when another
  paper uses it or it is not a workspace path. Each trash name is claimed by an
  exclusive create before the rename, so a file that appears there is never overwritten.
- Annotation pins: `FileAnnotationPinRepository`
  (`apps/web/src/features/papers/infrastructure/file-annotation-pin-repository.ts`)
  keeps a project's pins in `<project>/.weaveforge/annotation-pins.json`, one row per
  (paper, annotation key).
- Relations: the index reads each paper's `relations`. The shell command
  `index_relations_graph(rootId, depth)` returns the nodes within `depth` hops (both
  directions, at most 5) and the edges between them. A target no file declares comes
  back with `missing: true`. Papers of one project are `index_list("paper", project)`.

### Laws

| Law | Test |
| --- | --- |
| `parse(render(p)) == p` | `law_parse_render_is_identity` (`crates/wf-core/tests/papers_files.rs`) |
| `render(parse(f)) == f` for canonical `f` | `law_render_parse_is_identity` |
| A write keeps unknown keys byte for byte, the body and the relations | `law_write_keeps_what_it_does_not_own` |
| Writing the row a file reads as gives back that row | `law_write_of_own_row_is_identity` |
| A file from a newer app is never written | `newer_file_is_not_written`; TS "a file from a newer app is never overwritten" |
| `getById(save(p)) == p` | TS fast-check "law: getById(save(p)) == p" (`apps/web/src/features/papers/test/file-paper-repository.test.ts`) |
| `save` never drops the body or unknown keys of the file it rewrites | TS fast-check "law: save never drops the body or unknown keys …" |
| A write never removes a file; `delete(id)` moves that paper's file to `.weaveforge/trash/<day>/<path>` (a name clash gets `-2`, `-3`, …) | TS fast-check "law: delete moves exactly that paper's file to the trash …"; TS "delete moves the file to the workspace trash; it never unlinks", "deleting the same path twice keeps both copies in the trash" |
| `delete` also trashes the paper's sidecars and its PDF, under one day; a PDF another paper uses, or one outside the workspace, stays | TS "delete trashes the paper, its annotations and comments sidecars and its PDF together", "delete keeps a PDF another paper still uses, and never touches one outside the workspace" |
| A trash file that appears after `delete` looked is never overwritten | TS "delete never overwrites a trash file that appears after it looked (time-of-check gap)" |
| A new file is named after the title only; a clash gets `-2` | TS "a new file is named after the title only; a second paper of that title gets -2" |
| A file without `weaveforge-id` is the paper at its path and a write adds no id | `file_without_id_reads_and_is_not_given_one`, `new_file_without_id_has_no_id_line`; TS "a file with no weaveforge-id is the paper at its path; a write adds no id" |
| A CRLF file stays CRLF; text is not normalized | `crlf_file_reads_like_lf_and_stays_crlf`, `body_is_not_normalized`; TS "a CRLF file stays CRLF after setTags" |
| A missing timestamp is never written as an empty one | TS "a file without createdAt never gets an empty createdAt written" |
| A file that is not a paper is reported, never silently lost | TS "failures() names each file that is not a paper; list still skips it" |
| An edit made outside the app between a read and a write is kept | TS "setTags racing an outside edit keeps that edit" |
| Pins answer like a map keyed by (paper, annotation key); a pin row added outside the app is kept | TS fast-check "law: the file repository answers like a map keyed by (paper, annotation)" (`apps/web/src/features/papers/test/file-annotation-pin-repository.test.ts`); TS "a row added outside the app between read and write is kept" (`apps/web/src/lib/test/json-rows-file.test.ts`) |
| When two files claim one id, no write or delete touches either file; the error names both paths | TS "two files with one id: every write is refused and neither file changes" |
| A write happens only if the file is still what was read; a workspace without a conditional write (`writeTextIf`) is refused, never written blind | TS "without a conditional write the repository refuses to write" |
| A relation declared in a paper file and in `relations.json` is listed once by `relations_of` | `relation_in_file_and_relations_json_counts_once` (`crates/wf-core/tests/papers_files.rs`) |

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

