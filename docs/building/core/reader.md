- Zotero projection: the app calls `readyCore().projectZoteroAnnotations` directly from `paper-pdf-pane.tsx`. The TS wrapper `project-zotero-annotations.ts` was removed (batch 7).
# Reader core (`reader`)

The `reader` module holds the pure rules behind the PDF reader: where an
annotation sits, how ink strokes are shaped, what a search finds, how a deep
link is written, and which copy of a paper to open. It does no drawing and no
I/O, so every rule can be tested in Rust without a browser.

## Rust submodules

Each line is one file under `crates/wf-core/src/reader/`.

- `anchor`: resolve a text or geometry anchor to a position on the page.
- `annotation`: type guards for reader annotations and the keyboard command map.
- `annotation_backlinks`: reverse links from annotations to report sections (via pins) and the vault.
- `batch_annotation_ops`: image-region annotations for bulk extract.
- `citation_spans`: plan citation underlines by splitting text runs at mention offsets.
- `container_resize`: decide the scroll position when the reader container resizes.
- `create_tool`: rules for the create tool.
- `find_marks`: scrollbar tick positions for find matches.
- `free_copy`: the words for a search that opened nothing, and the open-access ids for a paper.
- `github_repo_path`: where a paper's PDF sits in the workspace's GitHub repo.
- `highlight_rects`: one clean band per line of a text highlight.
- `ink_stroke`: capture filtering, simplification and stroke width for pen input.
- `ink_undo`: undo and redo over pen strokes.
- `link_citations`: citation mentions taken from a page's internal `/Link` annotations.
- `locate`: lasso hit-testing, in-document search, and next/previous match stepping.
- `locus`: encode and decode deep links for jump-to-locus.
- `margin_notes`: lay out margin comment cards down the page margin (`layout_margin_notes`).
- `mark_actions`: what the popover on a tapped mark offers.
- `merge_annotations`: merge Zotero-projected and local annotations.
- `page_window`: which rendered pages to free as the reader scrolls.
- `paper_html`: how a paper kept as a web page is framed and read back.
- `paper_html_rules`: which responses count as a web page, and which charset to use.
- `pdf_cache_eviction`: which cached PDFs to drop once the cache is over its entry cap.
- `pdf_resolver_rules`: the open-access and WebDAV "does this step apply" and trim rules.
- `pdf_response`: which proxy responses count as a PDF.
- `pdf_source_ladder`: the order in which PDF resolvers are tried.
- `print`: a paper on paper, with every page's marks and, when asked, the comments beside each page.
- `reader_references`: join document analysis to the overlay's flat hit list.
- `reference_locate`: turn mention character offsets into page geometry.
- `reference_notice`: the one-line status in the reference popover.
- `sanitize_reader_url`: reader URL allowlists.
- `selection`: turn a text selection into an anchor, and a pdf.js text item into a rect.
- `split`: which pane sits beside the PDF in the side panel.
- `text_snap`: which text run a press beside the words was aimed at.
- `text_units`: UTF-16 offset helpers, matching JavaScript string indexing.
- `viewport`: viewport math, page projection and annotation sort keys.
- `zotero_projection`: project cached Zotero annotations into the reader annotation model.
- `zotero_sync`: sync decisions, field diffs, conflict merges and write payloads for Zotero.

## How the app calls it

The module is compiled into the wasm core and exported through
`crates/wf-wasm/src/reader_*.rs`. Each export uses
`#[wasm_bindgen(js_name = ...)]`, so the JavaScript name is camel case and
matches the Rust function. Examples:

- `reader_free_copy`: `describeFreeCopyFailure`, `isWebArticle`, `openAccessIdsOf`.
- `reader_margin_notes`: `layoutMarginNotes`, `stackMarginNotes`.
- `reader_print`: `readerPrintDocument`, `readerPrintOrientation`.
- `reader_locus`: `encodeLocus`, `decodeLocus`.
- `reader_anchor`: `resolveTextAnchor`.
- `reader_ink_stroke` and `reader_ink_undo`: stroke geometry and undo history.
- `reader_locate`: `findDocumentMatches`.
- `reader_paper_html`, `reader_pdf_response`, `reader_sanitize_reader_url`,
  `reader_viewport`, `reader_zotero_sync`: the rest of the reader surface.

TypeScript reaches these through the wrappers in `packages/wf-wasm/src`. The
wrappers call `readyCore()` for the loaded core, and `typedCore()` where a typed
view of the exports is needed. The app code in `apps/web/src/features/reader/`
calls the wrappers, not the wasm directly.

## What stays in TypeScript, and why

Some reader code stays in TypeScript on purpose. Each item below is a
KEEP decision, not a gap.

- The HTML relays: their fetch code is I/O and stays in TS. The pure rules
  live in `paper_html_rules.rs`; the proxy path comes from wasm
  (`crates/wf-wasm/src/reader_paper_html_rules.rs`).
- Opening a reader URL: the browser call stays in TS, for example
  `apps/web/src/features/reader/ui/reader-screen.tsx`. The allowlist lives in
  `sanitize_reader_url.rs` and is called through `readyCore()`.
- `apps/web/src/features/reader/application/parts.ts`: blocked.
  It needs a `ReaderAnnotation` type in Rust before it can move. Until that type
  exists, the helpers stay in TS.
- `crates/wf-core/src/reader/reference_actions.rs` (wasm `reader_reference_actions.rs`):
  the reference-action rules that `apps/web/src/features/reader/application/parts-2.ts`
  calls. The TS file keeps the clipboard and navigation calls.
- `crates/wf-core/src/reader/zotero_write_back_message.rs` (wasm `reader_zotero_sync.rs`):
  the Zotero annotation write-back message rules. `write-back-zotero-annotations.ts` keeps
  the network call.
- Anything that touches pdf.js, the DOM, IndexedDB, the network or Zotero's API
  stays in TS. Rust only receives plain numbers and values.
- `OpenAccessPdfResolver` and `WebDavPdfResolver` (`packages/core/src/reader/`):
  `supports` and the trim in `resolve` call `rust().openAccessSupports`,
  `rust().webdavSupports` and `rust().trimmedOrNone`. The fetch and the
  URL builders (`resolveUrl`, `buildProxiedUrl`) stay in TS and are injected.

## Related

- [Overleaf core](overleaf.md) for the other module with network I/O kept in TS.
- [Reader analysis core](reader-analysis.md) for the text analysis that feeds the reader.
- [Editor workspace core](editor-workspace.md) for the pane that holds the reader.

Source: `crates/wf-core/src/reader/`

## More reader modules

| Module | Rust fn | wasm export | TS caller |
| --- | --- | --- | --- |
| `dom_selection_range` | `text_selection_from_offsets`, `page_span_of` | `textSelectionFromOffsets`, `pageSpanOf` | `apps/web/src/features/reader/application/parts-1.ts`, `apps/web/src/features/reader/ui/pdf-reader/pdf-reader.tsx` |
| `free_copy_attempts` | `attempt_limits`, `pick_free_copy_attempts` | `freeCopyAttemptLimits`, `pickFreeCopyAttempts` | `apps/web/src/features/reader/application/parts-1.ts` |
| `paper_html_sanitize` | `chrome_selector`, `resolve_url` (consts `CHROME_SELECTORS`, `FORBID_TAGS`) | `paperHtmlChromeSelector`, `paperHtmlForbidTags`, `resolveAbsoluteUrl` | `apps/web/src/features/reader/infrastructure/sanitize-paper-html.ts` |
| `paper_html_store` | `paper_html_dir` | `paperHtmlDir` | `apps/web/src/features/reader/infrastructure/paper-html-store.ts` |
| `pdf_url_scheme` | `is_cache_pdf_url`, `is_stored_pdf_url`, `is_remote_pdf_url` | `isCachePdfUrl`, `isStoredPdfUrl`, `isRemotePdfUrl` | `apps/web/src/features/reader/application/parts-3.ts`, `apps/web/src/features/reader/ui/paper-pdf-pane.tsx`, `apps/web/src/features/reader/ui/pdf-reader/use-pdf-rendering.ts` |
| `reference_lookup` | `reference_cache_key`, `is_cache_entry_fresh`, `is_library_listing_fresh`, `should_store_lookup`, `lookup_attempts` | `referenceCacheKey`, `isReferenceCacheEntryFresh`, `isLibraryListingFresh`, `shouldStoreReferenceLookup`, `referenceLookupAttempts` | `apps/web/src/features/reader/application/parts-2.ts` |
| `zotero_write_back_reply` | `library_version`, `update_headers`, `update_url`, `update_outcome`, `create_outcomes` | `zoteroWriteBackLibraryVersion`, `zoteroWriteBackUpdateHeaders`, `zoteroWriteBackUpdateUrl`, `zoteroWriteBackUpdateOutcome`, `zoteroWriteBackCreateOutcomes` | `apps/web/src/features/reader/infrastructure/parts-2.ts` |

Rules:

- `dom_selection_range`: `text_selection_from_offsets` returns none for a negative or non-integer index or offset, and when both ends are the same point. `page_span_of` takes the other end's page when one end did not resolve. Reading the DOM `Selection` and resolving each end to a page stay in TS.
- `free_copy_attempts`: at most 6 PDF and 4 web-page candidates are tried, first in list order. Any other format is never tried. `attempt_limits` reports the caps; only tests read `freeCopyAttemptLimits`.
- `paper_html_sanitize`: holds the page-furniture selectors, the forbidden tags and the absolute-URL resolve. DOMPurify and the DOM walk stay in TS.
- `paper_html_store`: kept pages sit at `papers/html/<paperId>.html`; `paper_html_dir` names the folder the store creates before writing. IndexedDB rows and file I/O stay in TS.
- `pdf_url_scheme`: `is_cache_pdf_url` tests the scheme only; `cache://` decoding, blob minting and byte reads stay in TS. `is_remote_pdf_url` is true for http(s) addresses and same-origin paths.
- `reference_lookup`: the store key is `v5:<document>:ref:<index>` (`REFERENCE_CACHE_SCHEMA` = 5). Stored lookups answer for 30 days (`REFERENCE_CACHE_TTL_MS`) and library listings for 30 seconds (`LIBRARY_LIST_TTL_MS`). Only `resolved` lookups are kept across sessions; identifiers are tried strongest first.
- `zotero_write_back_reply`: builds the Zotero request headers, the update URL and the per-annotation outcome. `NOT_REPORTED_REASON` is the text for an annotation Zotero did not report as written. The fetch calls and the response body read stay in TS.

