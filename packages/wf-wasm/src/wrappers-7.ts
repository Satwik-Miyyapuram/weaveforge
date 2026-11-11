/**
 * Typed wrappers over the raw wasm exports, folded from 27 one-module files:
 * reader-annotation-draft, reader-annotation-helpers, reader-citation-spans,
 * reader-container-resize, reader-create-tool, reader-find-marks, reader-free-copy,
 * reader-highlight-rects, reader-ink-stroke, reader-ink-undo, reader-locate, reader-locus,
 * reader-margin-notes, reader-mark-actions, reader-page-window, reader-paper-html,
 * reader-pdf-response, reader-pdf-theme, reader-picture, reader-print, reader-reader-references,
 * reader-reference-actions, reader-reference-locate, reader-sanitize-reader-url, reader-split,
 * reader-text-snap, reader-zotero-projection.
 */
import {
  appendInkStroke as rawAppendInkStroke,
  applyAnnotationPatch as rawApplyAnnotationPatch,
  buildPaperHtmlDocument as rawBuildPaperHtmlDocument,
  buildReferenceIndex as rawBuildReferenceIndex,
  compactInkPath as rawCompactInkPath,
  decodeLocus as rawDecodeLocus,
  draftFromTextSelection as rawDraftFromTextSelection,
  draftImageRegion as rawDraftImageRegion,
  draftInkAnnotation as rawDraftInkAnnotation,
  draftPicture as rawDraftPicture,
  draftTextBox as rawDraftTextBox,
  eraseInkPaths as rawEraseInkPaths,
  findMarks as rawFindMarks,
  indexFromAnalysis as rawIndexFromAnalysis,
  inkPathsInPolygon as rawInkPathsInPolygon,
  isPdfContentType as rawIsPdfContentType,
  layoutMarginNotes as rawLayoutMarginNotes,
  listedAnnotations as rawListedAnnotations,
  locateMention as rawLocateMention,
  markActions as rawMarkActions,
  markPopoverShown as rawMarkPopoverShown,
  normalizeHighlightRects as rawNormalizeHighlightRects,
  optimisticAnnotationFromDraft as rawOptimisticAnnotationFromDraft,
  outlineItemsFor as rawOutlineItemsFor,
  pagePictures as rawPagePictures,
  pagesToEvict as rawPagesToEvict,
  projectZoteroAnnotations as rawProjectZoteroAnnotations,
  quantizeInkPath as rawQuantizeInkPath,
  resolvePaperPdfUrl as rawResolvePaperPdfUrl,
  shouldUseDarkPdfRendering as rawShouldUseDarkPdfRendering,
  simplifyInkPath as rawSimplifyInkPath,
  snapToText as rawSnapToText,
  takeInkRedo as rawTakeInkRedo,
  takeInkUndo as rawTakeInkUndo,
  unionRect as rawUnionRect,
} from "../pkg/wf_wasm.js";
import type { NewReaderAnnotation, ReaderAnnotation } from "@weaveforge/core";
import type {
  AnchorPdfLocus,
  AnnotationPatch,
  BoxSize,
  FindMarkMatch,
  FindMarkPage,
  ImageRegionDraft,
  InkDraft,
  InkUndoEntry,
  InkUndoState,
  MarginSlot,
  MarkTarget,
  PagePicture,
  PagePress,
  PaperHtmlPage,
  PictureDraftInput,
  ReaderPageProjection,
  ReaderPrintDocument,
  ReaderPrintLayoutInput,
  ReaderSplitPane,
  TextBoxDraft,
  TextRunBox,
  TextSelectionDraft,
  ZoteroAnnotationInput,
  ZoteroReaderAnnotation,
} from "./bindings.js";
import type { CombinedPdfAnchor, PageTextItem } from "./wrappers-9.js";

export {
  annotationPinKey,
  canJoinInkGroup,
  clampInkWidth,
  colourToolFor,
  containerResize,
  describeFreeCopyFailure,
  encodeLocus,
  findDocumentMatches,
  grownTextRect,
  hasPdfMagic,
  hostOf,
  inkNoteWidthToPdfPoints,
  inkPathJsonSize,
  inkPathsBounds,
  inkPathsHitTest,
  inkWidthForPressure,
  isAllowedPdfProxyUrl,
  isDismissTap,
  isHighlighterInk,
  isInkTool,
  isSubstantialPaperText,
  isWebArticle,
  looksLikePdfUrl,
  manualInputFromReference,
  markColourTool,
  meanPressure,
  mediaTypeEssence,
  mentionItemRanges,
  minArticleTextChars,
  minPaperTextChars,
  nextMatchIndex,
  openAccessIdsOf,
  paperHtmlCsp,
  parsePaperHtmlDocument,
  parseReaderSplitPane,
  pictureComment,
  pictureMeta,
  picturePath,
  pictureRect,
  planCitationSegments,
  pointInPolygon,
  pushInkUndo,
  readerPrintDocument,
  readerPrintOrientation,
  readFailureReason,
  referenceRef,
  refreshInkUndoAnnotation,
  renameInkUndoId,
  sanitizeAppHref,
  sanitizePdfUrl,
  sanitizeReaderHref,
  shouldAppendInkPoint,
  simplifyPathIndices,
  stackMarginNotes,
  textBoxFromRect,
  toolOwnsThePage,
  translateInkPaths,
} from "../pkg/wf_wasm.js";
export type {
  BoxSize,
  CitationItemRange,
  FindMark,
  FindMarkMatch,
  FindMarkPage,
  MarginSlot,
  MarkTarget,
  MentionGeometry,
  PagePress,
  PaperHtmlPage,
  ReaderPrintDocument,
  ReaderPrintLayoutInput,
  ReaderPrintNote,
  ReaderPrintPage,
  SnapHit,
  TextRunBox,
} from "./bindings.js";

// --- reader-annotation-draft ---
/**
 * Local annotation drafts (Rust `reader::annotation_draft`), re-exported from
 * index.ts. The draft, anchor and mark types come from ./bindings.ts.
 */
/** The mark for a text selection, or null when it has no placeable text. */
export function draftFromTextSelection(input: TextSelectionDraft): NewReaderAnnotation | null {
  return rawDraftFromTextSelection(input) as NewReaderAnnotation | null;
}

/** The ink mark to save, or null when nothing was drawn. */
export function draftInkAnnotation(input: InkDraft): NewReaderAnnotation | null {
  return rawDraftInkAnnotation(input) as NewReaderAnnotation | null;
}

/** The anchor with one more ink path, or null for a stroke too short to keep. */
export function appendInkStroke(anchor: CombinedPdfAnchor, path: number[]): CombinedPdfAnchor | null {
  return rawAppendInkStroke(anchor, path) as CombinedPdfAnchor | null;
}

/** The anchor with the ink paths under the eraser removed, or null when all were removed. */
export function eraseInkPaths(
  anchor: CombinedPdfAnchor,
  x: number,
  y: number,
  radius: number,
): CombinedPdfAnchor | null {
  return rawEraseInkPaths(anchor, x, y, radius) as CombinedPdfAnchor | null;
}

/** A region mark, or null for an empty region. */
export function draftImageRegion(input: ImageRegionDraft): NewReaderAnnotation | null {
  return rawDraftImageRegion(input) as NewReaderAnnotation | null;
}

/** A text-box mark. */
export function draftTextBox(input: TextBoxDraft): NewReaderAnnotation {
  return rawDraftTextBox(input) as NewReaderAnnotation;
}

// --- reader-annotation-helpers ---
/**
 * Local annotation records (Rust `reader::annotation_helpers`), re-exported from
 * index.ts. The annotation, patch and draft types come from ./bindings.ts.
 */
/** The full annotation after an edit. */
export function applyAnnotationPatch(ann: ReaderAnnotation, patch: AnnotationPatch): ReaderAnnotation {
  return rawApplyAnnotationPatch(ann, patch) as ReaderAnnotation;
}

/** The annotation to paint before its write returns. `now` is an ISO timestamp from the caller. */
export function optimisticAnnotationFromDraft(
  draft: NewReaderAnnotation,
  id: string,
  now: string,
): ReaderAnnotation {
  return rawOptimisticAnnotationFromDraft(draft, id, now) as ReaderAnnotation;
}

/** The marks the Annotations list shows (ink left out). */
export function listedAnnotations(annotations: readonly ReaderAnnotation[]): ReaderAnnotation[] {
  return rawListedAnnotations(annotations) as ReaderAnnotation[];
}

// --- reader-citation-spans ---
/**
 * Citation underline planning (Rust `reader_citation_spans`), re-exported from index.ts. Keeps the
 * signatures of apps/web/src/features/reader/application/citation-spans.ts. DOM decoration stays in TS.
 */
/** The part of a mention the planner needs. (Narrowing: `kind` is a TS literal union; Rust field is Option<String>.) */
export interface CiteSpan {
  key: string;
  start: number;
  end: number;
  text?: string;
  label?: string;
  kind?: "citation" | "figure" | "url";
  url?: string;
}

/** One piece of a run, split at mention boundaries. (Narrowing: uses the TS CiteSpan above.) */
export interface TextSegment {
  from: number;
  to: number;
  text: string;
  mention?: CiteSpan;
}

/** The page text item shape the planner reads: `str` and `hasEOL`. (Narrowing: Rust takes full SelectionPageTextItem.) */
export interface CitationPageTextItem {
  str: string;
  hasEOL?: boolean;
}

// --- reader-container-resize ---
/**
 * Container resize decision (Rust `reader_container_resize`). Keeps the rule of
 * apps/web/src/features/reader/ui/pdf-reader/container-resize.ts.
 */
/** `ignore` a same-size or hidden measure, `now` to refit at once, `settle` to wait for the size. (Narrowing: pure TS literal union, Rust returns &str.) */
export type ContainerResizeAction = "ignore" | "now" | "settle";

// --- reader-create-tool ---
/**
 * Create-tool rules (Rust `reader_create_tool`). Keeps the pure rules of
 * apps/web/src/features/reader/application/reader-annotation-helpers.ts and
 * ui/pdf-reader/colour-tools.ts.
 */
/** The colour a create or recolour draws with. (Narrowing: pure TS literal union, no Rust enum.) */
export type CreateColourTool = "pen" | "highlighter" | "highlight" | "underline" | "text";

// --- reader-find-marks ---
/**
 * Find-match scrollbar ticks (Rust `reader_find_marks`), re-exported from index.ts. The page lookups the
 * TS caller used to pass as callbacks are now precomputed into `pages`.
 */
/**
 * Where each match falls in the document, as a fraction of its full height. A match whose page text is not
 * loaded yet sits at the top of its page. Rust always fills both fields (the TS `FindMark` had no nulls),
 * so the wrapper narrows the generated `number | null` fields.
 */
export function findMarks(
  matches: readonly FindMarkMatch[],
  numPages: number,
  pages: readonly FindMarkPage[],
): { index: number; fraction: number }[] {
  return rawFindMarks(matches, numPages, pages) as { index: number; fraction: number }[];
}

// --- reader-free-copy ---
/**
 * "Find a free copy" messages and ids (Rust `reader::free_copy`). Keeps the
 * signatures of apps/web/src/features/reader/application/find-free-copy.ts.
 */
/** The ids a paper offers the open-access indexes, and its own link split into a PDF or a page. */
export interface FreeCopyIds {
  doi?: string | null;
  arxivId?: string | null;
  pmcid?: string | null;
  knownPdfUrl?: string | null;
  pageUrl?: string | null;
}

/** The "none" outcome of a search: what was listed, tried, and which indexes were asked or unreachable. */
export interface FreeCopyFailure {
  /** The outcome tag the app's search result carries; the message ignores it. */
  kind?: "none";
  listed: number;
  attempts: ReadonlyArray<{
    url: string;
    format: string;
    reason: "not-pdf" | "not-html" | "blocked" | "failed" | "abstract-only" | "no-storage";
  }>;
  unreachable: readonly string[];
  asked: readonly string[];
}

/** The fields of a paper that give its open-access ids. */
export interface FreeCopyPaperLinks {
  doi?: string | null;
  arxivId?: string | null;
  url?: string | null;
  metadata?: unknown;
}

// --- reader-highlight-rects ---
/**
 * Highlight rect normalisation (Rust `normalize_highlight_rects`), re-exported from index.ts. Keeps the
 * signature of apps/web/src/features/reader/application/normalize-highlight-rects.ts.
 */
/**
 * One clean band per line of a text highlight. Rects are PDF user space, `[x1, y1, x2, y2]` with a
 * bottom-left origin. Invalid rects are dropped.
 */
export function normalizeHighlightRects(rects: readonly (readonly number[])[]): number[][] {
  return rawNormalizeHighlightRects(rects) as number[][];
}

// --- reader-ink-stroke ---
/**
 * Reader ink stroke geometry (step 5-2e), re-exported from index.ts. Each wrapper
 * maps the TS signature of `packages/core/src/reader/parts.ts` onto the raw
 * Rust export; flat point arrays cross as `Float64Array`s and come back as `number[]`.
 */
export function simplifyInkPath(path: readonly number[], tolerance?: number): number[] {
  return Array.from(rawSimplifyInkPath(Float64Array.from(path), tolerance));
}

export function quantizeInkPath(path: readonly number[], decimals?: number): number[] {
  return Array.from(rawQuantizeInkPath(Float64Array.from(path), decimals));
}

export function compactInkPath(
  path: readonly number[],
  options?: { tolerance?: number; maxPoints?: number; decimals?: number },
): number[] {
  return Array.from(rawCompactInkPath(Float64Array.from(path), options));
}

// --- reader-ink-undo ---
/**
 * Reader ink undo stack (Rust `reader_ink_undo`), re-exported from index.ts. Each function keeps the
 * signature is InkUndoFns in packages/core/src/shared/core-contract.ts.
 */
/** How many steps are kept. A page of handwriting is a few hundred strokes. */
export const INK_UNDO_LIMIT = 200;

/** Nothing recorded yet. */
export const EMPTY_INK_UNDO: InkUndoState = { undo: [], redo: [] };

/** The step to undo, moved onto the redo stack; `null` when there is none. */
export function takeInkUndo(
  state: InkUndoState,
): { state: InkUndoState; entry: InkUndoEntry } | null {
  return rawTakeInkUndo(state) as { state: InkUndoState; entry: InkUndoEntry } | null;
}

/** The step to redo, moved back onto the undo stack; `null` when there is none. */
export function takeInkRedo(
  state: InkUndoState,
): { state: InkUndoState; entry: InkUndoEntry } | null {
  return rawTakeInkRedo(state) as { state: InkUndoState; entry: InkUndoEntry } | null;
}

// --- reader-locate ---
/**
 * Lasso hit-testing, document search and match stepping (steps 5-2e), re-exported from
 * index.ts. Rust `reader::locate` computes these; the signatures match
 * `packages/core/src/reader/parts.ts` (document search was formerly `document-search.ts`). `encodeLocus` and
 * `decodeLocus` live in `reader-locus.ts` (Rust).
 */
/** Rust `LASSO_CAUGHT_SHARE`; kept in step with it. */
const LASSO_CAUGHT_SHARE = 0.6;

/**
 * Whether a loop has caught a stroke: at least `share` of its points inside (Rust `ink_paths_in_polygon`).
 */
export function inkPathsInPolygon(
  paths: readonly (readonly number[])[],
  polygon: readonly number[],
  share = LASSO_CAUGHT_SHARE,
): boolean {
  const flat = Float64Array.from(paths.flatMap((path) => path));
  const lengths = Uint32Array.from(paths, (path) => path.length);
  return rawInkPathsInPolygon(flat, lengths, Float64Array.from(polygon), share);
}

// --- reader-locus ---
/**
 * Deep-link locus (de)serialisation for jump-to-source (Rust `crates/wf-core/src/reader/locus.rs`),
 * backed by Rust. Re-exported from index.ts.
 */
/** Parse a locus param back into a locus, or `null` when malformed (Rust `decode_locus`). */
export function decodeLocus(raw: string | null | undefined): AnchorPdfLocus | null {
  return rawDecodeLocus(raw ?? undefined) as AnchorPdfLocus | null;
}

// --- reader-margin-notes ---
/**
 * Margin comment card stacking (Rust `reader_margin_notes`). Keeps the stacking
 * step of apps/web/src/features/reader/application/margin-notes.ts.
 */
/** One annotation as margin layout reads it: its comment and picture state, and its mark's geometry. */
export interface MarginMark {
  hasComment: boolean;
  hasPicture: boolean;
  /** Flat `[x1, y1, x2, y2]` rects and `[x, y, ...]` paths in PDF user space; null without a zotero position. */
  geometry: { rects: number[][]; paths: number[][] } | null;
}

/**
 * Margin cards for one page (`layoutMarginNotes` in Rust). Returns `{ index, top, anchorTop }`
 * per card in ascending `anchorTop` order; `index` is the mark's position in `marks`.
 */
export function layoutMarginNotes(
  marks: readonly MarginMark[],
  projection: ReaderPageProjection,
  cardHeight: number,
): MarginSlot[] {
  return rawLayoutMarginNotes(marks, projection, cardHeight) as MarginSlot[];
}

// --- reader-mark-actions ---
/**
 * Mark popover decisions (Rust `reader_mark_actions`), re-exported from index.ts. Keeps the signatures of the removed
 * application/mark-actions.ts.
 */
/** What the popover on a tapped mark offers; null when it shows none. */
export interface MarkActions {
  /** The label over the popover: what the mark is. */
  kind: string;
  colour: boolean;
  /** The comment button's label, or null when the mark takes no comment. */
  comment: "Comment" | "Edit comment" | null;
  /** The composer's starting text: the comment already there. */
  prefill: string;
}


/** What the popover offers for a mark, or null when it offers nothing. */
export function markActions(ann: MarkTarget): MarkActions | null {
  return rawMarkActions(ann) as MarkActions | null;
}

/** A text box's popover shows under Select or Text; other marks under any tool. */
export function markPopoverShown(ann: Pick<MarkTarget, "type">, tool: string): boolean {
  return rawMarkPopoverShown(ann.type, tool);
}

// --- reader-page-window ---
/**
 * Rendered-page eviction (Rust `reader_page_window`). Keeps the signature of
 * apps/web/src/features/reader/ui/pdf-reader/pdf-page-window.ts. The idle
 * scheduling helper stays in TypeScript.
 */
/** Pages farther than this from every visible page are evicted by default. */
export const PDF_KEEP_RADIUS = 3;

/** The rendered pages more than `radius` pages from every visible page, sorted ascending. */
export function pagesToEvict(
  rendered: readonly number[],
  visible: readonly number[],
  radius: number = PDF_KEEP_RADIUS,
): number[] {
  return rawPagesToEvict(rendered, visible, radius) as number[];
}

// --- reader-paper-html ---
/**
 * Paper HTML framing (Rust `reader_paper_html`), re-exported from index.ts. Keeps the signatures of
 * the former apps/web/src/features/reader/application/paper-html.ts. The thresholds and the frame CSP
 * are read from Rust through getters, not module-level constants: the wasm module is not initialised
 * when this file is imported, so each getter must be called after loadCore.
 */
/** The framed, self-contained document for one kept paper. */
export function buildPaperHtmlDocument(
  page: PaperHtmlPage,
  options: { scheme?: "light" | "dark"; print?: boolean } = {},
): string {
  return rawBuildPaperHtmlDocument(page, options);
}

// --- reader-pdf-response ---
/**
 * PDF response rules (Rust `reader_pdf_response`), re-exported from index.ts. Keeps the signatures of the
 * removed TS pdf-response-rules.
 */
/** Whether a `Content-Type` value names a PDF. */
export function isPdfContentType(value: string | null): boolean {
  return rawIsPdfContentType(value ?? undefined);
}

// --- reader-pdf-theme ---
/**
 * Dark PDF rendering choice (Rust `reader::pdf_theme`), re-exported from index.ts.
 */
/** Whether PDF pages render dark: `mode` is `"dark"`, or `themeId` names a dark theme. */
export function shouldUseDarkPdfRendering(
  themeId: string | null | undefined,
  mode?: string | null,
): boolean {
  return rawShouldUseDarkPdfRendering(themeId ?? undefined, mode ?? undefined) as boolean;
}

// --- reader-picture ---
/**
 * Placed pictures (Rust `reader::picture`), re-exported from index.ts. `picturePath`
 * is exported by ./reader-mark-actions.ts. The picture types come from ./bindings.ts.
 */
/** The placed pictures on a page, figure-ready and in paint order. */
export function pagePictures(annotations: readonly ReaderAnnotation[], pageHeight: number): PagePicture[] {
  return rawPagePictures(annotations, pageHeight) as PagePicture[];
}

/** A new picture mark sized to half the page at the picture's own aspect. */
export function draftPicture(input: PictureDraftInput): NewReaderAnnotation {
  return rawDraftPicture(input) as NewReaderAnnotation;
}

// --- reader-print ---
/**
 * The reader's printable paper, re-exported from feature-wrappers.ts. The types come from
 * bindings.ts; the functions are the Rust `reader_print_document` and `reader_print_orientation`.
 */
/** Landscape beside the comments, or portrait on its own (Rust `reader_print_orientation`). */
export type ReaderPrintOrientation = "portrait" | "landscape";

// --- reader-reader-references ---
/**
 * Reference index (Rust `reader_reader_references`), re-exported from index.ts. The flat lists come from
 * the core; the Map shapes the overlay reads are built here, so callers keep their signatures.
 */
/** A clickable thing found in the page text. Shape of the Rust MentionHit, serialised camelCase. */
export interface MentionHit {
  key: string;
  kind: "citation" | "figure" | "url";
  start: number;
  end: number;
  label: string;
  url?: string;
  refIndexes: number[];
  rects?: number[][];
  target?: unknown;
  source?: string;
  confidence?: number;
}

/** One parsed bibliography entry as the core serialises it. Callers pick a richer type through the generic `R`. */
export interface ParsedReferenceEntry {
  index: number;
  raw: string;
}

/** Flat index as the core returns it. `byIndex` is rebuilt from `references` and `mentionsByPage` into a Map. */
interface FlatReferenceIndex<R extends ParsedReferenceEntry> {
  references: R[];
  mentionsByPage: { pageNumber: number; mentions: MentionHit[] }[];
  bodyFontSize: number;
  fingerprint: string;
}

export interface ReaderReferenceIndex<R extends ParsedReferenceEntry = ParsedReferenceEntry> {
  references: R[];
  byIndex: Map<number, R>;
  mentionsByPage: Map<number, MentionHit[]>;
  bodyFontSize: number;
  fingerprint: string;
}

/** The page shape the core reads: 1-based page number, text items, and `/Link` annotations. */
export interface ReferencePage {
  pageNumber: number;
  items: readonly { str: string; hasEOL?: boolean }[];
  links?: readonly object[];
}

function toMaps<R extends ParsedReferenceEntry>(flat: FlatReferenceIndex<R>): ReaderReferenceIndex<R> {
  return {
    references: flat.references,
    byIndex: new Map(flat.references.map((ref) => [ref.index, ref])),
    mentionsByPage: new Map(flat.mentionsByPage.map((page) => [page.pageNumber, page.mentions])),
    bodyFontSize: flat.bodyFontSize,
    fingerprint: flat.fingerprint,
  };
}

/** The pages' runs as outline items, one array per page. */
export function outlineItemsFor(pages: readonly ReferencePage[]): unknown[][] {
  return rawOutlineItemsFor(pages) as unknown[][];
}

/** Shape a completed analysis (plain arrays from the worker) into the overlay's index. */
export function indexFromAnalysis<R extends ParsedReferenceEntry = ParsedReferenceEntry>(
  analysis: unknown,
  pages: readonly ReferencePage[],
): ReaderReferenceIndex<R> {
  return toMaps(rawIndexFromAnalysis(analysis, pages) as FlatReferenceIndex<R>);
}

/** Analyze the pages and shape the result in one step. */
export function buildReferenceIndex<R extends ParsedReferenceEntry = ParsedReferenceEntry>(
  pages: readonly ReferencePage[],
  outline: readonly unknown[] = [],
): ReaderReferenceIndex<R> {
  return toMaps(rawBuildReferenceIndex(pages, outline) as FlatReferenceIndex<R>);
}

// --- reader-reference-actions ---
/**
 * Reference popover rules: the paper reference a bibliography entry resolves by,
 * and the fields a manual add can fill (R5), re-exported from index.ts. The adds
 * themselves stay in packages/core and apps/web.
 */
/** The bibliographic hints a title search carries (Rust `ReferenceHints`). */
export interface ReferenceHints {
  title?: string;
  year?: number;
  firstAuthor?: string;
}

/** The paper reference a bibliography entry resolves by (Rust `ReferenceRef`). */
export type ReferenceRef =
  | { kind: "doi"; value: string }
  | { kind: "arxiv"; value: string }
  | { kind: "bibliographic"; value: string; hints: ReferenceHints };

/** The fields a manual add can fill from an entry (Rust `ManualPaperInput`). */
export interface ManualPaperInput {
  title: string;
  status: "to_read";
  authors?: string[];
  year?: number;
  doi?: string;
  arxivId?: string;
  url?: string;
}

// --- reader-reference-locate ---
/**
 * Mention geometry (Rust `reader_reference_locate`), re-exported from index.ts. Keeps the signatures of the removed
 * application/reference-locate.ts.
 */
/** `[x0, y0, x1, y1]` in PDF user space, origin bottom-left. */
export type PdfRect = [number, number, number, number];

/**
 * A page text item as the locator reads it: `str`, `hasEOL`, and the `transform`, `width` and `height`
 * that place the rects. Passing only `str` would yield no geometry.
 */
export type LocatePageTextItem = PageTextItem;

/** Rects covering `[start, end)` of the page text. Out-of-range or empty ranges yield no geometry. */
export function locateMention(
  items: readonly LocatePageTextItem[],
  start: number,
  end: number,
): { rects: PdfRect[]; bounds: PdfRect | null } {
  // Rust fills every side (the TS geometry had no nulls); the generated type reads `number | null`.
  return rawLocateMention(items, start, end) as { rects: PdfRect[]; bounds: PdfRect | null };
}

/** Smallest rect containing every input rect, or null when given none. */
export function unionRect(rects: readonly PdfRect[]): PdfRect | null {
  return rawUnionRect(rects) as PdfRect | null;
}

// --- reader-sanitize-reader-url ---
/**
 * Reader URL allowlists (Rust `reader_sanitize_reader_url`). Keeps the pure rules of
 * apps/web/src/features/reader/application/sanitize-reader-url.ts.
 */
/** The paper fields a PDF URL is derived from. `pdfPath` is ignored and not passed. */
export interface PaperPdfSource {
  url?: string | null;
  arxivId?: string | null;
  openAccessPdf?: string | null;
}

/** Best-effort map from a paper's links and arXiv id to a PDF URL the reader can open. */
export function resolvePaperPdfUrl(source: PaperPdfSource): string | null {
  return rawResolvePaperPdfUrl({
    url: source.url ?? null,
    arxivId: source.arxivId ?? null,
    openAccessPdf: source.openAccessPdf ?? null,
  }) ?? null;
}

// --- reader-split ---
/**
 * The reader's side panel choice (Rust `reader::split`), re-exported from index.ts.
 */
export type { ReaderSplitPane };

// --- reader-text-snap ---
/**
 * Press snapping for the text layer (Rust `reader_text_snap`). Keeps the
 * shape of apps/web/src/features/reader/ui/pdf-reader/text-snap.ts. Callers
 * pass plain boxes copied from `getBoundingClientRect()`, not DOMRects, since
 * DOMRect getters do not cross the wasm boundary.
 */
/**
 * The text run nearest a press beside the words, or null when none is in reach. Rust always fills the caret
 * position, so the wrapper narrows the generated `number | null` fields.
 */
export function snapToText(runs: readonly TextRunBox[], x: number, y: number): { index: number; x: number; y: number } | null {
  return rawSnapToText(
    runs.map((run) => ({ left: run.left, top: run.top, right: run.right, bottom: run.bottom })),
    x,
    y,
  ) as { index: number; x: number; y: number } | null;
}

// --- reader-zotero-projection ---
/**
 * Zotero annotation projection (Rust `reader::zotero_projection`), re-exported from index.ts.
 * Keeps the signature of apps/web reader/application/project-zotero-annotations.ts.
 */
/** Cached Zotero annotations as reader annotations; notes are dropped, the rest sorted by position. */
export function projectZoteroAnnotations(
  annotations: readonly ZoteroAnnotationInput[],
  options?: { contentHash?: string; now?: string },
): ZoteroReaderAnnotation[] {
  return rawProjectZoteroAnnotations(
    [...annotations],
    options?.contentHash?.trim() || undefined,
    options?.now,
  ) as ZoteroReaderAnnotation[];
}
