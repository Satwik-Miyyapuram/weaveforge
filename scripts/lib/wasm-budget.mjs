/**
 * Pure helpers for `scripts/check-wasm-budget.mjs`: the gzipped size the browser
 * downloads, measured against a budget. No I/O, so the tests can pin them.
 */
import { gzipSync } from "node:zlib";

/**
 * Repo-relative paths the browser downloads: the module and the wasm-bindgen
 * JS glue, which grows with every export. The budget is their summed gzip size.
 */
export const WASM_BUDGET_FILES = ["packages/wf-wasm/pkg/wf_wasm_bg.wasm", "packages/wf-wasm/pkg/wf_wasm.js"];

// Lower it when the size drops; raising it needs a note here saying which
// crate or feature made it grow.
// - P0.3c: 12,676 bytes (module 10,889 + glue 1,787), coreInfo only. 14 KB.
// - P1.2: 125,322 bytes (module 121,471 + glue 3,851). The tokenizer exports
//   pull in wf-core's search module and its Unicode tables: the data section
//   is 84.6 KB gzipped (NFD and NFC tables from unicode-normalization, general
//   category from unicode-properties, std lowercase), code 34.8 KB. The TS
//   got these from the JS engine for free; exact parity needs them. The .wasm
//   loads lazily, not in first-load JS. 136 KB leaves ~11% for the query,
//   fusion and excerpt exports (P1.4, P1.7).
// - P1.7b: 141,676 bytes (module 136,659 + glue 5,017), the CI Linux build.
//   buildExcerpt adds wf-core's excerpt module plus serde for its result
//   (~5 KB). 142 KB is the last search export's ceiling; P1.8 deletes TS, not WASM.
// - P1.7c: 144,895 bytes (module 139,878 + glue 5,017), the CI Linux build.
//   wasm-release opt-level "s" instead of "z" for speed: indexTerms on 232k
//   chars of prose takes 17 ms instead of 24 ms (TS: 37 ms) for ~3.2 KB more
//   gzip. Still under 142 KB, so the budget stays.
// - Step 0b-1: 201,775 bytes (module 195,978 + glue 5,797), the Windows build
//   (it matched the Linux one to 46 bytes on the base). The paper exports
//   (parsePaperRef, extractDoi, extractPageMetadata, ...) bring wf-core's papers
//   module and regex-lite (~55 KB). The full regex crate's Unicode tables made
//   it 466 KB, so wf-core uses regex-lite. 200 KB is this batch's ceiling; the
//   sync exports (0b-2+) raise it again with their own note.
// - Step 0b-2: 217,181 bytes (module 210,591 + glue 6,590); the Windows and
//   CI Linux builds are byte-identical.
//   The sync and workspace exports (changedSide, decideGitSyncPath, describePull,
//   safeWorkspacePath, ...) add ~15 KB: wf-core's sync module plus serde
//   deserializers for the tagged pull and push results. checkGitRemoteUrl is
//   not exported: the url crate (idna and its Unicode tables) cost 88 KB, and
//   the browser already has URL. 215 KB is this batch's ceiling.
// - Step 0b-3: 265,661 bytes (module 258,324 + glue 7,337), the Windows build.
//   The folder-merge exports (mergeVaultPage, vaultPageBase/Side, mergeHunks,
//   writeConflictMarkers, read/writeFrontmatter) add ~47 KB. Most of it is
//   vaultPageBase/Side (~35 KB raw gzip alone): they parse a note through
//   wf-core's workspace deserializer, which later batches export anyway. The
//   rest is the line diff, the frontmatter number parsing and formatting, and
//   serde_json::Value crossing to and from JS. 262 KB is this batch's ceiling.
// - Step 0b-4: 281,383 bytes (module 272,569 + glue 8,814), the Windows build.
//   The offline-merge, ink note, text diff, image, blob link and folder layout
//   exports (mergeRows, read/writeInkNoteBody, diffBody, imagePathsInBody,
//   toRelativeBlobLinks, projectDir, jsonKindOfPath, ...) add ~15 KB: those
//   wf-core modules plus serde for their results, whose TS types are now
//   generated from wf-core. 276 KB is this batch's ceiling.
// - Step 0b-5b: 329,219 bytes (module 319,694 + glue 9,525), the Windows build.
//   The folder export, import parse and import diff exports (serializeWorkspace,
//   parseWorkspaceFolder, diffWorkspace, parseJsonData, diffJsonData, ...) add
//   ~48 KB: wf-core's workspace serializer (paper, report, experiment and log
//   writers, frontmatter and ink note output), the folder parser and diff, the
//   JSON data diff, and serde for the snapshot rows and the diff results.
//   330 KB is this batch's ceiling.
// - Step 5.2a: 375,051 bytes (module 364,614 + glue 10,437), the Windows build.
//   The paste exports (cleanPastedText, cleanWrappedText, cleanPdfText,
//   cleanUrlsWithRules, normalizePasteSettings, ...) add ~45 KB: wf-core's
//   paste module (wrapped and PDF text rejoining, smart punctuation, URL
//   tracker rules, tables, the verbatim-context scan) and serde for the
//   settings and results. 370 KB is this batch's ceiling.
// - Step 5.2b: 385,845 bytes (module 374,192 + glue 11,653), the Windows build.
//   The ink geometry exports (smoothInkStroke, inkCurveAt, nibWidth,
//   packInkStroke, the zoom steps, ...) add ~12 KB: wf-core's ink module
//   (resampling, binomial smoothing, Hermite curves, the stroke packer) and
//   the wasm-bindgen glue for the typed arrays. 380 KB is this batch's ceiling.
// - Step 5.2c: 392,979 bytes (module 380,569 + glue 12,410), the Linux CI build.
//   The line segmentation and recognition exports (segmentInkLines,
//   inkLineRecords, mapInkConfidence, inkVocabularyHints, ...) add ~7 KB:
//   wf-core's ink segment and recognise modules plus serde for the line
//   records. Strokes cross as typed arrays and segmentation sorts by binary
//   insertion, which saved ~4 KB over serde input and sort_by. 390 KB is this
//   batch's ceiling.
// - Step 5.2d: 400,999 bytes (module 388,473 + glue 12,526), the Linux CI build.
//   decodeInkWords adds ~8 KB: wf-core's ink decode module (reading choice,
//   UTF-16 edit distance, joins and line alternatives), the vocabulary
//   HashSet and serde for the word readings. 400 KB is this batch's ceiling.
// - Step 5.2e: 430,523 bytes (module 415,000 + glue 15,523), local build.
//   The PDF reader exports (anchor resolution, ink stroke geometry, document
//   search and lasso, viewport fit and projection, the keyboard map) add
//   ~30 KB: five wf-core reader modules, serde for their selector and state
//   objects, and the glue for ~60 new exports. 440 KB is this batch's ceiling.
// - Step 5.2f: 469,372 bytes (module 451,720 + glue 17,652), local build.
//   Locus links, selection anchors, Zotero annotation sync, line and column
//   reconstruction and the citation text helpers add ~39 KB: five wf-core
//   modules, NFKC/NFKD composition tables for searchTextFromItems and
//   surnameKey, serde for the Zotero rows and ~35 new exports. 480 KB is this
//   batch's ceiling.
// - Step 5.2g: 526,813 bytes (module 506,509 + glue 20,304), local build.
//   Citation candidates, the text outline, bibliography parsing, cite keys,
//   .bib entries, paper titles and vault page rules add ~57 KB: seven wf-core
//   modules, each with its own regex-lite patterns (the bibliography alone
//   builds ~30), serde for the analysis objects and ~45 new exports. 540 KB
//   is this batch's ceiling.
// - Step 5.2g (document analysis): 567,695 bytes (module 547,306 + glue
//   20,389), local build. analyzePdfDocument and markdownToLatex add ~41 KB:
//   the document analysis pipeline (sections, figures, equations, citation
//   assembly) and the Markdown to LaTeX converter, each with its own
//   regex-lite patterns and serde for their nested results. 580 KB is this
//   batch's ceiling.
// - Steps 5.2h-5.2j: ~606.2 KB gzipped, local build. Paper and report records,
//   JS locale collation, screening records and relation graph settings add
//   ~38 KB: five wf-core modules with serde for their record shapes and the
//   collation tables. 640 KB is this batch's ceiling.
// - Steps 5.2k-5.2l: ~641.7 KB gzipped, local build. Theme file parsing,
//   appearance settings, dashboard layout, AI context and wiki index,
//   experiment status and lab snapshot add ~36 KB, mostly serde for their
//   record shapes. 700 KB is the ceiling for these and the next batch (5.2m).
// - Steps 5.2m-5.2p: ~747.4 KB gzipped, local build. Search (acronyms,
//   settings, tuning, chunks, fusion, PageRank, wiki graph), AI access policy,
//   MCP result shaping, wiki merge, ink undo, link citations, sharing, plan,
//   logbook, reading lists, relations, URL safety and settings rows add
//   ~106 KB over 21 wf-core modules, mostly serde for their record shapes.
//   760 KB is this batch's ceiling.
// - TS removal (lanes A-E): ~1026.2 KB gzipped, Windows build (release,
//   opt-level "s", LTO, no debug sections). Lanes B and E (reader analysis,
//   ink, Zotero sync, papers) add ~146 KB, lane D (editor workspace: pane
//   tree, tabs, workspace tree) ~64 KB, lane C (search, paste, dashboard, AI
//   policy) ~28 KB, org and member types ~13 KB: the TypeScript twins these
//   replace are deleted, so the app ships one copy. 1080 KB is this batch's
//   ceiling.
// - TS removal (lanes 1-5, A-E, second round): ~1280.7 KB gzipped, Windows
//   build. ~255 KB over ~60 wf-core modules: reader (annotation backlinks,
//   batch ops, merge, split, cache eviction), relations (graph tags, topology,
//   local graph, node colouring), ink (clip, vocab match, PDF pages, chunk
//   read), sync (Mattermost, integration fields, PGlite SQL, deletion
//   conflicts), storage and integration config, workspace, dashboard, AI
//   retrieval and the vault template engine, mostly serde for their record
//   shapes. Their TypeScript twins are deleted. 1340 KB is this batch's
//   ceiling.
export const WASM_GZIP_BUDGET = 1340 * 1024;

/**
 * Gzipped byte length of a module, with zlib's default options.
 * @param {Uint8Array} bytes the raw module
 * @returns {number} compressed length in bytes
 */
export function gzipSize(bytes) {
  return gzipSync(bytes).length;
}

/**
 * Compare a gzipped size with the budget and describe the result.
 * @param {number} gzipBytes measured gzipped size
 * @param {number} budget the budget in bytes
 * @returns {{ ok: boolean, message: string }}
 */
export function checkWasmBudget(gzipBytes, budget) {
  if (gzipBytes <= budget) {
    return { ok: true, message: `WASM budget OK: ${kb(gzipBytes)} gzipped (budget ${kb(budget)})` };
  }
  return {
    ok: false,
    message:
      `WASM budget FAIL: ${kb(gzipBytes)} gzipped is over the ${kb(budget)} budget. ` +
      "Shrink it, or raise WASM_GZIP_BUDGET in scripts/lib/wasm-budget.mjs with a note saying what grew.",
  };
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
