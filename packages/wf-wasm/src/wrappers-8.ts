/**
 * Typed wrappers over the raw wasm exports, folded from 18 one-module files:
 * reader-annotation-rows, reader-selection, reader-viewport, reader-zotero-sync, reading-list,
 * reading-lists-extraction, recent-targets, related-paper-hit, relations-local-graph,
 * repo-web-url, report-artifacts, report-bib-entries, report-cite-key, report-markdown-to-latex,
 * report-records, report-results-presence, report-results-tables, screening-records.
 */
import {
  agreementBetween as rawAgreementBetween,
  annotationRowToDomain as rawAnnotationRowToDomain,
  checkBibliography as rawCheckBibliography,
  cloneLinks as rawCloneLinks,
  commitUrl as rawCommitUrl,
  createReportSectionWith as rawCreateReportSectionWith,
  decideAnnotationSync as rawDecideAnnotationSync,
  exclusionReasons as rawExclusionReasons,
  filterGraphByNodes as rawFilterGraphByNodes,
  formatPaperCitation as rawFormatPaperCitation,
  hasResultsTables as rawHasResultsTables,
  invertedAbstract as rawInvertedAbstract,
  itemToRect as rawItemToRect,
  latestByReviewerList as rawLatestByReviewerList,
  listMembershipByKey as rawListMembershipByKey,
  localSubgraph as rawLocalSubgraph,
  markdownToLatex as rawMarkdownToLatex,
  openAlexToHit as rawOpenAlexToHit,
  outlineProgress as rawOutlineProgress,
  parseBibEntries as rawParseBibEntries,
  parseLatexSectionTree as rawParseLatexSectionTree,
  pdfPointToScreen as rawPdfPointToScreen,
  pdfRectToScreenBox as rawPdfRectToScreenBox,
  pinRecentTargets as rawPinRecentTargets,
  prismaCounts as rawPrismaCounts,
  prismaFigureTex as rawPrismaFigureTex,
  relationTitles as rawRelationTitles,
  reportSectionInputError as rawReportSectionInputError,
  repoWebUrl as rawRepoWebUrl,
  resolveArtifactRefsMarkdown as rawResolveArtifactRefsMarkdown,
  resolveCiteKey as rawResolveCiteKey,
  reviewers as rawReviewers,
  s2ToHit as rawS2ToHit,
  screeningDecisionError as rawScreeningDecisionError,
  screenPointToPdf as rawScreenPointToPdf,
  sectionProgress as rawSectionProgress,
  seedDoi as rawSeedDoi,
  selectionToAnchor as rawSelectionToAnchor,
  uniqueCiteKey as rawUniqueCiteKey,
  uniqueFigureNameIn as rawUniqueFigureNameIn,
  verdictFor as rawVerdictFor,
  zoteroWriteBackAnnotations as rawZoteroWriteBackAnnotations,
  zoteroWriteBackMessage as rawZoteroWriteBackMessage,
} from "../pkg/wf_wasm.js";
import type {
  Agreement,
  AnchorCombinedPdf as CombinedPdfAnchor,
  BibEntry,
  BibliographyReport,
  BibParseResult,
  BibWarning,
  CiteKeyPaper,
  ExclusionReasonCount,
  ExtractionValues,
  ItemVerdict,
  LatexSectionTree,
  LatexSourceFile,
  ListMembershipKey,
  MarkdownToLatexResult,
  NewReportSectionInput,
  PrismaCounts,
  PrismaFigureOptions,
  ReaderAnnotation,
  ReaderAnnotationRow,
  ReaderPageProjection,
  ReadingList,
  ReadingListTreeNode,
  RelatedPaperCollectOutput,
  RelatedPaperHitRow,
  RelatedPaperKeys,
  ReportExperiment,
  ReportSection,
  ReportSectionTreeNode,
  ScreeningDecision,
  ScreeningDecisionDraft,
  ScreeningDecisionRow,
  ScreeningItem,
  ScreeningStage,
  SectionProgress,
  SelectionPageTextGeometry as PageTextGeometry,
  SelectionPageTextItem as PageTextItem,
  SelectionTextRange as TextSelectionRange,
  ZoteroAnnotationDecision,
  ZoteroAnnotationLocal,
  ZoteroAnnotationSyncRow,
} from "./bindings.js";

export {
  artifactBasename,
  buildAnnotationSortIndex,
  buildListTree,
  buildProposeFillPrompt,
  buildSectionTree,
  clampPage,
  clampScale,
  clampZoomFactor,
  collectNewHits,
  computeFitPageScale,
  computeFitWidthScale,
  countSectionSources,
  createReportSectionWith,
  deepestFirstListIds,
  diffAnnotationFields,
  editedRelativeLabel,
  emptyCellPaperIds,
  escapeLatexText,
  extractionCsv,
  extractionMarkdown,
  flattenPaperRows,
  formatCitation,
  initialReaderViewport,
  isRecentTarget,
  isZoteroLibrarySyncMode,
  linkNodeId,
  listDisplayColor,
  localKeys,
  nextRotation,
  normalisePageRotation,
  normalizeProjectPath,
  parseArtifactRefs,
  parseResultsTableRefs,
  pendingFieldFills,
  pendingKey,
  prismaCaveat,
  projectedPageSize,
  readingListNameMatches,
  reportSectionInputError,
  resolveAnnotationConflict,
  resolveResultsTables,
  resolveViewportScale,
  s2NestedFields,
  safeArtifactCaption,
  safeImageDestination,
  screeningDecisionFromRow,
  screeningDecisionToRow,
  serialiseArtifactRef,
  serialiseResultsTableRef,
  sortByCitations,
  toZoteroWritePayload,
  uniqueFigureNameIn,
  visualPageSize,
  zoomIn,
  zoomOut,
} from "../pkg/wf_wasm.js";
export type {
  ExtractionFieldDef,
  ExtractionPaper,
  ExtractionPendingFill,
  ExtractionProposal,
  ExtractionRow,
  ExtractionValues,
  FillPaper,
  ListMembershipKey,
  ProposeFillInput,
  ReadingList,
  ReadingListItem,
  ReadingListTreeNode,
  RelatedPaperCollectOutput,
  RelatedPaperHitRow,
  RelatedPaperKeys,
  ScreeningDecisionRow,
} from "./bindings.js";

// --- reader-annotation-rows ---
/**
 * Stored reader annotation row to domain annotation (Rust `reader::annotation_rows`), re-exported
 * from index.ts.
 */
/**
 * The row as a `ReaderAnnotation`.
 *
 * @throws `Error` (`Invalid annotation type in store: <type>`) when the row's type is unknown.
 */
export function annotationRowToDomain(row: ReaderAnnotationRow): ReaderAnnotation {
  return rawAnnotationRowToDomain(row) as ReaderAnnotation;
}

// --- reader-selection ---
/**
 * Text-selection anchors and text-item rects (formerly `packages/core/src/reader/selection-to-anchor.ts`),
 * backed by Rust. Offsets are UTF-16 code units, as in the TS copy. Re-exported from index.ts.
 */
/**
 * Convert a text-layer selection into a CombinedPdfAnchor, or `null` when the selection is
 * empty or out of range (Rust `selection_to_anchor`).
 */
export function selectionToAnchor(
  selection: TextSelectionRange,
  page: Omit<PageTextGeometry, "items"> & { items?: readonly PageTextItem[] },
): CombinedPdfAnchor | null {
  const anchor = rawSelectionToAnchor(selection, page) as CombinedPdfAnchor | null;
  // TS always sets the contentHash key, undefined when the page has none.
  return anchor && { contentHash: undefined, ...anchor };
}

/**
 * pdf.js text-item transform to a PDF user-space rect `[x1, y1, x2, y2]`, narrowed to
 * `charFrom`..`charTo`; `null` when there is no renderable geometry (Rust `item_to_rect`).
 */
export function itemToRect(
  item: PageTextItem,
  charFrom = 0,
  charTo = Number.POSITIVE_INFINITY,
): number[] | null {
  return rawItemToRect(item, charFrom, charTo) as number[] | null;
}

// --- reader-viewport ---
/**
 * Reader viewport math, PDF page projection and annotation sort keys (Rust
 * `reader::viewport`), re-exported from index.ts. Each function keeps the
 * signature and defaults of the removed packages/core/src/reader/reader-viewport.ts,
 * page-projection.ts and sort-index.ts. Object shapes come from ./bindings.ts.
 */
/** PDF user-space point to CSS pixels within the rendered page box. */
export function pdfPointToScreen(x: number, y: number, p: ReaderPageProjection): { x: number; y: number } {
  return rawPdfPointToScreen(x, y, p) as { x: number; y: number };
}

/** CSS pixels within the rendered page box to a PDF user-space point. */
export function screenPointToPdf(sx: number, sy: number, p: ReaderPageProjection): { x: number; y: number } {
  return rawScreenPointToPdf(sx, sy, p) as { x: number; y: number };
}

/** A PDF-space rect `[x1,y1,x2,y2]` as a screen-space box, corners re-normalised. */
export function pdfRectToScreenBox(
  rect: readonly [number, number, number, number],
  p: ReaderPageProjection,
): { left: number; top: number; width: number; height: number } {
  return rawPdfRectToScreenBox(Float64Array.from(rect), p) as { left: number; top: number; width: number; height: number };
}

// --- reader-zotero-sync ---
/**
 * Zotero write-back decisions, field diffs, conflict merges and payloads (R5),
 * re-exported from index.ts. The dry-run and live push classes stay in packages/core.
 * Types come from ./bindings.ts; the sync mode and conflict choice unions are inline.
 */
/**
 * What a sync should do with one annotation (Rust `decide_annotation_sync`).
 * Unknown modes act as `bidirectional`.
 */
export function decideAnnotationSync(
  row: ZoteroAnnotationSyncRow,
  mode: "bidirectional" | "read_only" | "ignored" | undefined,
): ZoteroAnnotationDecision {
  // A missing mode acts as `bidirectional` in TS; "" does the same in Rust.
  return rawDecideAnnotationSync(row, mode ?? "") as ZoteroAnnotationDecision;
}

/**
 * The annotations a write-back sends: everything but ink, and only those with a
 * PDF page (Rust `zotero_write_back_annotations`).
 */
export function zoteroWriteBackAnnotations<T extends ZoteroAnnotationLocal>(
  annotations: readonly T[],
): T[] {
  const kept = rawZoteroWriteBackAnnotations(annotations) as number[];
  return kept.map((index) => annotations[index]!);
}

/** A write-back run's counts (TS `ZoteroAnnotationWriteBackSummary`). */
export interface ZoteroWriteBackSummary {
  created: number;
  updated: number;
  conflicts: number;
  failed: number;
  /** The first failure's reason. */
  firstError?: string;
}

/**
 * The write-back's part of the sync line, led by its separator, or "" when nothing
 * was owed or there is no summary (Rust `zotero_write_back_message`).
 */
export function zoteroWriteBackMessage(summary: ZoteroWriteBackSummary | null): string {
  return rawZoteroWriteBackMessage(summary);
}

// --- reading-list ---
/**
 * Reading-list tree helper (Rust `reading_lists::reading_list`), re-exported from index.ts.
 * Keeps the signature of packages/core/src/features/reading-lists/domain/parts.ts.
 */
/** The reading list shapes callers type their state with. */

/**
 * Which list holds which resource: `listId -> the ids in it`. Every list gets an entry,
 * including the empty ones. Rust `reading_lists::reading_list::list_membership`.
 */
export function listMembershipByKey(
  lists: readonly { id: string }[],
  items: readonly { listId: string; paperId?: string | null; vaultPageId?: string | null }[],
  key: ListMembershipKey,
): Map<string, Set<string>> {
  const pairs = rawListMembershipByKey(lists, items, key) as [string, string[]][];
  return new Map(pairs.map(([id, ids]): [string, Set<string>] => [id, new Set(ids)]));
}

/**
 * The titles of related papers joined by `, ` in the order given; an id with no title shows as
 * the id. Rust `reading_lists::extraction_keys::relation_titles`.
 */
export function relationTitles(ids: readonly string[], titleById: ReadonlyMap<string, string>): string {
  return rawRelationTitles(ids, Object.fromEntries(titleById));
}

// --- reading-lists-extraction ---
/**
 * Extraction-table rules (Rust `reading_lists::extraction_table`). Cell values with rollup
 * columns, markdown and CSV export, empty cells, the fill prompt and pending fills. The web
 * adapter in `apps/web/.../application/extraction-rows.ts` does the paper lookups.
 */
/** A listed paper that exists: its index in `knownIds`, and its values keyed by field id. */
export interface FlatPaperRow {
  paperIndex: number;
  values: ExtractionValues["values"];
}

// --- recent-targets ---
/**
 * Jump-list recents (Rust `recent_targets`), re-exported from index.ts.
 */
/**
 * `items` with the recently opened ones moved to the front, in visit order and
 * flagged `recent`. A recent target that no longer matches an item is skipped
 * (Rust `pin_recent_targets` picks the slots; the items keep their identity).
 */
export function pinRecentTargets<T extends { kind: string; id: string }>(
  items: readonly T[],
  recents: readonly { kind: string; id: string }[],
): (T & { recent?: true })[] {
  const slots = rawPinRecentTargets(items, recents) as { index: number; recent: boolean }[];
  return slots.map(({ index, recent }) => {
    const item = items[index] as T;
    return recent ? { ...item, recent: true as const } : item;
  });
}

// --- related-paper-hit ---
/**
 * Related-paper hit mappers (Rust `related_paper_hit`), re-exported from index.ts.
 * Keeps the results of the helpers in
 * apps/web/src/features/papers/application/parts-1.ts.
 */
/** The hit for a Semantic Scholar paper, or null when it has no title. */
export function s2ToHit(paper: unknown): RelatedPaperHitRow | null {
  return (rawS2ToHit(paper) as RelatedPaperHitRow | undefined) ?? null;
}

/** The hit for an OpenAlex work, or null when it has no title. */
export function openAlexToHit(work: unknown): RelatedPaperHitRow | null {
  return (rawOpenAlexToHit(work) as RelatedPaperHitRow | undefined) ?? null;
}

/** The abstract text rebuilt from OpenAlex's word -> positions index, or undefined. */
export function invertedAbstract(index: unknown): string | undefined {
  return (rawInvertedAbstract(index) as string | undefined) ?? undefined;
}

/** The seed's DOI, or the arXiv DOI for an arXiv paper, or undefined. */
export function seedDoi(doi: string | null | undefined, arxivId: string | null | undefined): string | undefined {
  return (rawSeedDoi(doi ?? undefined, arxivId ?? undefined) as string | undefined) ?? undefined;
}

// --- relations-local-graph ---
/**
 * Local graph subgraph and the graph helpers the canvas applies to it (Rust
 * `relations::local_graph`), re-exported from index.ts.
 */
/**
 * The nodes whose id is in `allowed` (all of them when `null`), and the links whose two
 * endpoints both remain. Works on copies: the inputs are not mutated.
 */
export function filterGraphByNodes<T extends { id: string }, L extends Record<"source" | "target", string | { id: string }>>(
  nodes: T[],
  links: L[],
  allowed: Set<string> | null,
): { nodes: T[]; links: L[] } {
  return rawFilterGraphByNodes(nodes, links, allowed ? [...allowed] : null) as {
    nodes: T[];
    links: L[];
  };
}

/** Copies of the links with string endpoints, every other field kept. */
export function cloneLinks<L extends Record<"source" | "target", string | { id: string }>>(
  links: L[],
): (L & Record<"source" | "target", string>)[] {
  return rawCloneLinks(links) as (L & Record<"source" | "target", string>)[];
}

/**
 * The nodes within `depth` hops of `seedId`, the seed included, or null when there is no seed
 * or `depth` is below 1.
 */
export function localSubgraph(
  seedId: string | null,
  depth: number,
  neighbors: Map<string, Set<string>>,
): Set<string> | null {
  const pairs = [...neighbors].map(([id, ns]): [string, string[]] => [id, [...ns]]);
  const ids = rawLocalSubgraph(seedId, depth, pairs) as string[] | null;
  return ids ? new Set(ids) : null;
}

// --- repo-web-url ---
/**
 * Git repo web links (Rust `repo_web_url`), re-exported from index.ts.
 * Keeps the signatures of apps/web/src/features/sync/infrastructure/parts.ts.
 */
/** The trimmed repo URL when it is http(s), otherwise undefined. */
export function repoWebUrl(repoUrl?: string): string | undefined {
  return rawRepoWebUrl(repoUrl) ?? undefined;
}

/** A commit's web URL from a repo URL and sha, or undefined. */
export function commitUrl(repoUrl?: string, sha?: string): string | undefined {
  return rawCommitUrl(repoUrl, sha) ?? undefined;
}

// --- report-artifacts ---
/**
 * Experiment artifact references in report markdown (Rust `report::artifact_refs` and
 * `report::artifact_markdown`), re-exported from index.ts. Each function keeps the signature of
 * the TS function it replaces in apps/web/src/features/report/application.
 */
/** Replaces each reference with its figure, or a warning line. `nowMs` drives the stale check. */
export function resolveArtifactRefsMarkdown(
  body: string,
  experiments: readonly ReportExperiment[],
  nowMs: number = Date.now(),
): string {
  return rawResolveArtifactRefsMarkdown(body, experiments, nowMs);
}

// --- report-bib-entries ---
/**
 * Bib entry parsing (Rust `report::bib_entries`), re-exported from index.ts. Keeps the signature of
 * packages/core/src/features/report/domain/parts.ts. Rust sends each entry's fields as an
 * ordered `{ name, value }` list; this wrapper rebuilds the `fields` record in that order.
 */
/**
 * Parses every `.bib` among `files`; non-`.bib` files are ignored. Bad entries become warnings.
 * Each entry's `fields` is a record in source order.
 */
export function parseBibEntries(files: readonly LatexSourceFile[]): {
  entries: (Omit<BibEntry, "fields"> & { fields: Record<string, string> })[];
  warnings: BibWarning[];
} {
  const raw = rawParseBibEntries(files) as BibParseResult;
  return {
    entries: raw.entries.map((entry) => ({
      type: entry.type,
      key: entry.key,
      fields: Object.fromEntries(entry.fields.map((field) => [field.name, field.value])),
      file: entry.file,
      line: entry.line,
    })),
    warnings: raw.warnings,
  };
}

/** Outline of a LaTeX project from `entryFile` (default `main.tex`); see core `LatexSectionTreeFns`. */
export function parseLatexSectionTree(
  sources: readonly LatexSourceFile[],
  entryFile = "main.tex",
): LatexSectionTree {
  return rawParseLatexSectionTree(sources, entryFile) as LatexSectionTree;
}

// --- report-cite-key ---
/**
 * Cite-key resolution and citation formatting (Rust `report::cite_key`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/features/report/domain/parts.ts.
 * The paper input is the subset of `Paper` these functions read. Types come from ./bindings.ts.
 */
function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toCiteKeyPaper(paper: Parameters<typeof resolveCiteKey>[0]): CiteKeyPaper {
  const meta = paper.metadata ?? {};
  return {
    id: paper.id,
    doi: stringField(paper.doi),
    arxivId: stringField(paper.arxivId),
    bibtex: stringField(paper.bibtex),
    citeKey: stringField(meta["citeKey"]),
    citationKey: stringField(meta["citationKey"]),
    extra: stringField(meta["extra"]),
  };
}

/**
 * A paper's preferred cite key, without uniqueness suffixing. Never empty. `paper` is the subset of
 * `Paper` these functions read; a `Paper` satisfies it.
 */
export function resolveCiteKey(paper: {
  id: string;
  doi?: string;
  arxivId?: string;
  bibtex?: string;
  metadata?: Record<string, unknown>;
}): string {
  return rawResolveCiteKey(toCiteKeyPaper(paper));
}

/**
 * {@link resolveCiteKey}, made unique against keys already taken. `used` is mutated: the returned
 * key is added to it, so the next paper with the same key gets a suffix.
 */
export function uniqueCiteKey(
  paper: Parameters<typeof resolveCiteKey>[0],
  used: Set<string>,
): string {
  const key = rawUniqueCiteKey(toCiteKeyPaper(paper), [...used]);
  used.add(key);
  return key;
}

/** Resolve then format in one step for a paper. */
export function formatPaperCitation(
  paper: Parameters<typeof resolveCiteKey>[0],
  format: "latex" | "pandoc" | "footnote" | "raw",
): string {
  return rawFormatPaperCitation(toCiteKeyPaper(paper), format);
}

// --- report-markdown-to-latex ---
/**
 * Report Markdown to LaTeX (Rust `report::markdown_to_latex`), re-exported from index.ts.
 * Keeps the signatures of packages/core/src/features/report/domain/parts.ts.
 * Object shapes come from ./bindings.ts.
 */
/**
 * The report Markdown as a LaTeX body, with warnings, figures and cited keys. `citeByTitle`
 * maps normalized paper titles to bib keys.
 */
export function markdownToLatex(
  md: string,
  opts: { citeByTitle?: ReadonlyMap<string, string> } = {},
): MarkdownToLatexResult {
  const citeByTitle = opts.citeByTitle ? Object.fromEntries(opts.citeByTitle) : undefined;
  return rawMarkdownToLatex(md ?? "", { citeByTitle }) as MarkdownToLatexResult;
}

/** A file-safe figure name not in `used`; the name is added to `used`. */
export function uniqueFigureName(raw: string, used: Set<string>): string {
  const name = rawUniqueFigureNameIn(raw, [...used]);
  used.add(name);
  return name;
}

// --- report-records ---
/**
 * Report rules (Rust `report::prisma_figure`, `report::project_path`, `report::bibliography_report`,
 * `report::report_section`), re-exported from index.ts. Each function keeps the signature of the TS
 * file of the same name in packages/core/src/features/report/domain.
 */
/** The PRISMA flow diagram as a LaTeX figure. */
export function prismaFigureTex(
  counts: PrismaCounts,
  options: Omit<PrismaFigureOptions, "reasons"> & { reasons?: readonly ExclusionReasonCount[] | null } = {},
): string {
  return rawPrismaFigureTex(counts, options);
}

/** Every citation and bibliography finding in the project's sources. Entries carry their fields as a record, as in core. */
export function checkBibliography(input: {
  sources: readonly LatexSourceFile[];
  bibliography: {
    entries: readonly (Omit<BibEntry, "fields"> & { fields: Record<string, string> })[];
    warnings: readonly BibWarning[];
  };
}): BibliographyReport {
  return rawCheckBibliography({
    sources: input.sources,
    bibliography: {
      entries: input.bibliography.entries.map((entry) => ({
        ...entry,
        fields: Object.entries(entry.fields).map(([name, value]) => ({ name, value })),
      })),
      warnings: input.bibliography.warnings,
    },
  }) as BibliographyReport;
}

/** A new section from caller input. Throws `ReportSectionValidationError` before drawing an id. */
export function createReportSection(
  input: NewReportSectionInput,
  deps: { clock: { nowIso(): string }; ids: { newId(): string } },
): ReportSection {
  const message = rawReportSectionInputError(input);
  if (message != null) {
    const error = new Error(message);
    error.name = "ReportSectionValidationError";
    throw error;
  }
  const id = deps.ids.newId();
  const now = deps.clock.nowIso();
  return rawCreateReportSectionWith(input, id, now) as ReportSection;
}

/** A section's words against its target, `null` where there is no target (`report::section_progress`). */
export type { SectionProgress };

/** Words written under a section, its own text and every subsection's, against its target. */
export function sectionProgress(node: ReportSectionTreeNode): SectionProgress {
  return normalizeProgress(rawSectionProgress(node));
}

/** The whole outline: its top-level sections added up. */
export function outlineProgress(roots: readonly ReportSectionTreeNode[]): SectionProgress {
  return normalizeProgress(rawOutlineProgress(roots));
}

/** Rust `None` crosses as `undefined`; the TS shape uses `null`. */
function normalizeProgress(raw: unknown): SectionProgress {
  const p = raw as { words: number; target?: number | null; pct?: number | null };
  return { words: p.words, target: p.target ?? null, pct: p.pct ?? null };
}

// --- report-results-presence ---
/**
 * Results-table presence in a report tree (Rust `report::results_tables_presence`), re-exported from
 * index.ts. Keeps the signature of the TS `hasResultsTables` it replaces in
 * apps/web/src/features/overleaf/application/parts.ts.
 */
/** The part of a report section tree node the presence check reads. */
export interface ResultsTablesTreeNode {
  section: { notes?: string | null };
  children: readonly ResultsTablesTreeNode[];
}

/** Whether any section in the tree, or a descendant, has an `exptable:` reference in its notes. */
export function hasResultsTables(nodes: readonly ResultsTablesTreeNode[]): boolean {
  return rawHasResultsTables(nodes);
}

// --- report-results-tables ---
/**
 * Results tables in report notes (Rust `report::results_table_refs`), re-exported from index.ts.
 * Each function keeps the signature of the TS function it replaces in
 * apps/web/src/features/report/application/results-table-refs.ts.
 */
/** One `exptable:` reference in report markdown, with UTF-16 start and end offsets. */
export interface ResultsTableRef {
  experimentIds: string[];
  caption: string;
  start: number;
  end: number;
  raw: string;
}

/** The fields of an experiment the tables read; the app's `Experiment` fits it. */
export interface ResultsTableExperiment {
  id: string;
  name: string;
  metrics?: Record<string, unknown> | null;
}

// --- screening-records ---
/**
 * Screening rules (Rust `reading_lists::screening`), re-exported from index.ts. Each function
 * keeps the signature of packages/core/src/features/reading-lists/domain/parts.ts.
 * Decision lists cross as JSON text: one copy, not a boundary call per field.
 */
/** Throws `ScreeningError` when `next` may not be recorded after `existing`. */
export function checkDecision(
  next: Pick<ScreeningDecision, "itemId" | "reviewerId" | "stage" | "state">,
  existing: readonly ScreeningDecision[],
): void {
  const draft = { ...next, stage: String(next.stage), state: String(next.state) };
  const message = rawScreeningDecisionError(draft, JSON.stringify(existing));
  if (message != null) {
    const error = new Error(message);
    error.name = "ScreeningError";
    throw error;
  }
}

/** Why `next` may not be recorded after `existing`, or null when it may. */
export function screeningDecisionError(
  next: ScreeningDecisionDraft,
  existing: readonly ScreeningDecision[],
): string | null {
  return rawScreeningDecisionError(next, JSON.stringify(existing)) ?? null;
}

/** `latestByReviewer` as a list, one decision per reviewer. */
export function latestByReviewerList(
  decisions: readonly ScreeningDecision[],
  itemId: string,
  stage: ScreeningStage,
): ScreeningDecision[] {
  return rawLatestByReviewerList(JSON.stringify(decisions), itemId, stage) as ScreeningDecision[];
}

/** The latest decision each reviewer recorded for one item, one per reviewer. */
export function latestByReviewer(
  decisions: readonly ScreeningDecision[],
  itemId: string,
  stage: ScreeningStage,
): Map<string, ScreeningDecision> {
  const latest = rawLatestByReviewerList(JSON.stringify(decisions), itemId, stage) as ScreeningDecision[];
  return new Map(latest.map((decision) => [decision.reviewerId, decision]));
}

/** Where one item stands at one stage. */
export function verdictFor(
  decisions: readonly ScreeningDecision[],
  itemId: string,
  stage: ScreeningStage,
): ItemVerdict {
  return rawVerdictFor(JSON.stringify(decisions), itemId, stage) as ItemVerdict;
}

/** Percent agreement and Cohen's kappa for two reviewers at one stage. */
export function agreementBetween(
  decisions: readonly ScreeningDecision[],
  reviewers: [string, string],
  stage: ScreeningStage,
): Agreement {
  return rawAgreementBetween(JSON.stringify(decisions), reviewers, stage) as Agreement;
}

/** The PRISMA numbers, derived from the decisions every time they are asked for. */
export function prismaCounts(items: readonly ScreeningItem[], decisions: readonly ScreeningDecision[]): PrismaCounts {
  return rawPrismaCounts(JSON.stringify(items), JSON.stringify(decisions)) as PrismaCounts;
}

/** Everyone who recorded a decision: distinct reviewer ids, sorted in UTF-16 order. */
export function reviewers(decisions: readonly ScreeningDecision[]): string[] {
  return rawReviewers(JSON.stringify(decisions)) as string[];
}

/** Why items were excluded at `stage`, most common first. */
export function exclusionReasons(
  decisions: readonly ScreeningDecision[],
  stage: ScreeningStage = "full_text",
): ExclusionReasonCount[] {
  return rawExclusionReasons(JSON.stringify(decisions), stage) as ExclusionReasonCount[];
}
