/**
 * Typed wrappers over the raw wasm exports, folded from 23 one-module files:
 * pdf-text-prune, personalized-pagerank, pitch-share-card, plan-feed, plan-widget,
 * postgrest-spec, privacy-disclaimer-readiness, project-pick, projects, proposal-apply,
 * proposal-groups, proposal-inputs, quick-open, reader-analysis-bibliography,
 * reader-analysis-citations, reader-analysis-document, reader-analysis-lines,
 * reader-analysis-outline, reader-analysis-structure, reader-analysis-text, reader-anchor,
 * reader-annotation, reader-annotation-geometry.
 */
import {
  addDays as rawAddDays,
  analyzePdfDocument as rawAnalyzePdfDocument,
  assemblePageCitations as rawAssemblePageCitations,
  bucketAnnotationsByPage as rawBucketAnnotationsByPage,
  chooseAnchorStrategy as rawChooseAnchorStrategy,
  citationItemToRect as rawCitationItemToRect,
  findCitationCandidates as rawFindCitationCandidates,
  findFigureMentions as rawFindFigureMentions,
  findHeadingLines as rawFindHeadingLines,
  findPatternCitationMentions as rawFindPatternCitationMentions,
  findQuoteMatches as rawFindQuoteMatches,
  findReferenceSection as rawFindReferenceSection,
  groupProposals as rawGroupProposals,
  groupRecurringLines as rawGroupRecurringLines,
  isCitationDestination as rawIsCitationDestination,
  isEditableReaderTarget as rawIsEditableReaderTarget,
  labelNumber as rawLabelNumber,
  milestonesToIcs as rawMilestonesToIcs,
  normaliseWhitespace as rawNormaliseWhitespace,
  parsePlanWidgetBounds as rawParsePlanWidgetBounds,
  partitionPdfTexts as rawPartitionPdfTexts,
  personalizedPageRank as rawPersonalizedPageRank,
  pickNearestMatch as rawPickNearestMatch,
  pickProject as rawPickProject,
  planFeedUrls as rawPlanFeedUrls,
  planWidgetData as rawPlanWidgetData,
  postgrestKeyedColumnSpec as rawPostgrestKeyedColumnSpec,
  postgrestRowSpec as rawPostgrestRowSpec,
  projectName as rawProjectName,
  proposalApplies as rawProposalApplies,
  proposalExperimentUpdate as rawExperimentUpdate,
  readerKeyboardCommand as rawReaderKeyboardCommand,
  reconstructLines as rawReconstructLines,
  relatedByPpr as rawRelatedByPpr,
  resolvePositionSelector as rawResolvePositionSelector,
  resolveTextAnchor as rawResolveTextAnchor,
  shouldShowWorkspaceLoader as rawShouldShowWorkspaceLoader,
  sortByReadingOrder as rawSortByReadingOrderIndices,
} from "../pkg/wf_wasm.js";
import type { ReaderAnnotation } from "../../core/src/index.js";
import type {
  AnalysisCitationMention,
  AnalysisPageTextRange,
  AnalysisParsedReference,
  AnalysisPdfItem,
  AnalysisPdfPage,
  AnalysisTextLine,
  AnalysisTextLine as TextLine,
  AnchorCombinedPdf,
  AnchorConfidence,
  AnchorPdfLocus,
  AnchorPositionSelector,
  AnchorQuoteSelector,
  AnchorStrategy,
  AnchorTextSpan,
  AnchorVia,
  CitationCandidate,
  DocumentAnalysis,
  FeedMilestone,
  FigureMention,
  FigurePage,
  KeyedColumnSpec,
  OutlineReaderItem,
  OutlineRecurringGroupIndices,
  PageBucket,
  PdfIndexSource,
  PickableProject,
  PlanFeedUrls,
  PlanWidgetBounds,
  PlanWidgetData,
  PprOptions,
  ProposalGroup,
  ProposalRef,
  QuickOpenGroup,
  QuickOpenResult,
  ReaderKeyboardCommand,
  ReferenceSectionSpan,
  RelatedNode,
  RowSpec,
} from "./bindings.js";
import type { ReadonlyInput } from "./readonly-input.js";

export {
  appOriginFrom,
  bodyFontSize,
  cleanWidgetPalette,
  coalesceMentions,
  composeSpacingAccents,
  detectCitationStyle,
  detectColumns,
  extractVenue,
  findCitationCandidates,
  fontSizeOf,
  furnitureKey,
  furnitureLines,
  groupResults,
  headingOutline,
  inReferenceList,
  isAnnotationSyncState,
  isBibliographicMatch,
  isBoldFont,
  isReaderAnnotationType,
  isRotatedText,
  levenshtein,
  matchAuthorYearText,
  matchPageCitations,
  mentionRects,
  nativeCitationMentions,
  originalRange,
  outlineFromText,
  outlineIsPlausible,
  outlineItemOf,
  outlineTextLines,
  pageTextFromItems,
  paintedOrder,
  parseBibliography,
  parseBibliographyEntry,
  parseTaskbarCreatedId,
  pitchShareCard,
  pitchShareConstants,
  placePlanWidget,
  planFeedOrigin,
  projectPageAnnotationGeometry,
  proposalAppendVaultNoteBody,
  proposalEditVaultNote,
  proposalExperimentFollowUp,
  proposalLogEntry,
  proposalMilestoneFollowUp,
  proposalMilestoneStatus,
  proposalPaperAnnotation,
  proposalPaperFieldFill,
  proposalPaperFieldId,
  proposalPaperNoteAddition,
  proposalPaperUpdate,
  proposalReadingListChange,
  proposalRelation,
  proposalReportNotes,
  proposalVaultNote,
  proposalZoteroImport,
  quickOpenResults,
  rectanglesOverlap,
  searchTextFromItems,
  shouldMountShellChildren,
  splitBibliographyEntries,
  splitByAuthorStart,
  splitByMargins,
  splitNumberedEntries,
  stepCursor,
  stripInvisible,
  surnameKey,
  textFingerprint,
  titleOf,
  titleSimilarity,
} from "../pkg/wf_wasm.js";
export type {
  KeyedColumnSpec,
  OrderSpec,
  PickableProject,
  PlanWidgetBounds,
  PlanWidgetWorkArea,
  ProposalGroup,
  ProposalRef,
  RowSpec,
} from "./bindings.js";

// --- pdf-text-prune ---
/**
 * PDF text orphan partition (Rust `search::pdf_text_prune`), re-exported from index.ts.
 */
export interface PdfTextPartition {
  /** Indexes into the input of the texts whose paper still exists, in input order. */
  readonly kept: readonly number[];
  /** Pages held per kept paper; a repeated paper keeps its last count. */
  readonly pageCounts: Map<string, number>;
  /** Paper id of each orphan, in input order; one entry per orphan, so ids may repeat. */
  readonly orphanPaperIds: readonly string[];
}

/** Splits stored PDF texts by whether their paper id is in `paperIds`. */
export function partitionPdfTexts(
  stored: readonly ReadonlyInput<PdfIndexSource>[],
  paperIds: readonly string[],
): PdfTextPartition {
  const raw = rawPartitionPdfTexts(stored, paperIds) as {
    kept: number[];
    pageCounts: Record<string, number>;
    orphanPaperIds: string[];
  };
  return {
    kept: raw.kept,
    pageCounts: new Map(Object.entries(raw.pageCounts)),
    orphanPaperIds: raw.orphanPaperIds,
  };
}

// --- personalized-pagerank ---
/**
 * Monte Carlo personalized PageRank (Rust `personalized_pagerank`), re-exported from index.ts.
 * Each function keeps the signature of the old TS module (removed; its types now live in packages/core/src/shared/core-contract.ts).
 */
/** Map edges become entries in insertion order, which the Rust side keeps. */
function toWasmGraph(graph: { nodes: string[]; edges: Map<string, string[]> }) {
  return {
    nodes: graph.nodes,
    edges: [...graph.edges].map(([node, neighbours]) => ({ node, neighbours })),
  };
}

function toWasmOptions(options: { numWalks?: number; maxSteps?: number; damping?: number }): PprOptions {
  return { numWalks: options.numWalks, maxSteps: options.maxSteps, damping: options.damping };
}

export function personalizedPageRank(
  graph: { nodes: string[]; edges: Map<string, string[]> },
  seed: string,
  options: { numWalks?: number; maxSteps?: number; damping?: number; rng?: () => number } = {},
): Map<string, number> {
  const scores = rawPersonalizedPageRank(
    toWasmGraph(graph),
    seed,
    toWasmOptions(options),
    options.rng ?? Math.random,
  ) as { node: string; score: number }[];
  return new Map(scores.map((s) => [s.node, s.score]));
}

/** Top-k neighbours by PPR, excluding the seed itself. */
export function relatedByPpr(
  graph: { nodes: string[]; edges: Map<string, string[]> },
  seed: string,
  limit = 10,
  options: { numWalks?: number; maxSteps?: number; damping?: number; rng?: () => number } = {},
): RelatedNode[] {
  // Rust returns every neighbour; slicing here keeps JS `slice` semantics for any limit.
  const related = rawRelatedByPpr(
    toWasmGraph(graph),
    seed,
    0xffffffff,
    toWasmOptions(options),
    options.rng ?? Math.random,
  ) as RelatedNode[];
  return related.slice(0, limit);
}

// --- pitch-share-card ---
/**
 * Pitch link-preview card data (Rust `pitch_share_card`). The Next `Metadata`
 * object and `metadataBase` are built in apps/web; this module supplies the text,
 * the paths and the origin rule.
 */
export interface PitchShareImage {
  url: string;
  width: number;
  height: number;
  alt: string;
}

export interface PitchShareCard {
  title: string;
  description: string;
  ogType: string;
  siteName: string;
  locale: string;
  url: string;
  image: PitchShareImage;
  twitterCard: string;
}

export interface PitchShareConstants {
  title: string;
  description: string;
  defaultAppOrigin: string;
}

// --- plan-feed ---
/**
 * Plan feed (Rust `plan::feed`), re-exported from index.ts: the iCalendar of
 * dated milestones and the JSON summary a desktop or home-screen widget reads.
 */
/** The calendar, https and widget links for `token` (Rust `plan::feed_urls::plan_feed_urls`). */
export function planFeedUrls(
  origin: string,
  token: string,
  options: { includeDone?: boolean; reminderDays?: number } = {},
): PlanFeedUrls {
  return rawPlanFeedUrls(origin, token, options.includeDone ?? false, options.reminderDays ?? 0) as PlanFeedUrls;
}

/** The `.ics` text for `items`: one all-day event per dated milestone, with a reminder. */
export function milestonesToIcs(
  items: readonly FeedMilestone[],
  options: { includeDone?: boolean; reminderDays?: number; now: Date },
): string {
  return rawMilestonesToIcs(
    items,
    options.includeDone ?? false,
    Math.floor(options.reminderDays ?? 0),
    options.now.getTime(),
  );
}

/** The deadlines a widget draws (soonest first, overdue included) plus overdue and undated counts. */
export function planWidgetData(
  items: readonly FeedMilestone[],
  options: { includeDone?: boolean; limit?: number; now: Date },
): PlanWidgetData {
  return rawPlanWidgetData(
    items,
    options.includeDone ?? false,
    options.limit,
    options.now.getTime(),
  ) as PlanWidgetData;
}

/** `iso` (YYYY-MM-DD) moved by whole calendar days; no time zone can shift it. Throws on a non-date. */
export function addDays(iso: string, days: number): string {
  return rawAddDays(iso, Math.trunc(days));
}

// --- plan-widget ---
/**
 * Plan desktop widget rules (Rust `plan_widget`), re-exported from index.ts. The types mirror the
 * Rust structs (bindings.ts).
 */
/** The widget's colours and shape, by CSS variable name. (Narrowing: pure TS Record alias; no Rust struct.) */
export type PlanWidgetPalette = Record<string, string>;

/** The saved position from the preference JSON, or null. A non-string reads as null. */
export function parsePlanWidgetBounds(stored: unknown): PlanWidgetBounds | null {
  if (typeof stored !== "string") return null;
  return rawParsePlanWidgetBounds(stored) as PlanWidgetBounds | null;
}

// --- postgrest-spec ---
/**
 * PostgREST table specs (Rust `postgrest_spec`): which table, columns, project scope, order and
 * filters a generic repository uses.
 */
/** The row spec named `name`, or `null` when there is none. */
export function postgrestRowSpec(name: string): RowSpec | null {
  return (rawPostgrestRowSpec(name) as RowSpec | null) ?? null;
}

/** The keyed-column spec named `name`, or `null` when there is none. */
export function postgrestKeyedColumnSpec(name: string): KeyedColumnSpec | null {
  return (rawPostgrestKeyedColumnSpec(name) as KeyedColumnSpec | null) ?? null;
}

// --- privacy-disclaimer-readiness ---
/**
 * Privacy-disclaimer shell gate (Rust `privacy_disclaimer_readiness`), re-exported from
 * index.ts. Both functions are pure: no I/O.
 */
/**
 * Whether the workspace loader shows. `error` is the startup error text, or nothing; an
 * empty string counts as no error, as it does in Rust.
 */
export function shouldShowWorkspaceLoader(
  loading: boolean,
  needsPrivacyAccept: boolean,
  containerReady: boolean,
  error?: string | null,
): boolean {
  return rawShouldShowWorkspaceLoader(
    loading,
    needsPrivacyAccept,
    containerReady,
    error ?? undefined,
  );
}

// --- project-pick ---
/**
 * MCP project pick (Rust `sync::project_pick`), re-exported from index.ts.
 * Keeps `pickProject` in apps/shell/sidecar/src/local-mcp-projects.ts; it returns the index so
 * the caller keeps its own object.
 */
/** The index of the one project `needle` picks. Throws an `Error` naming the miss or the ambiguity. */
export function pickProject(projects: readonly PickableProject[], needle: string | null): number {
  try {
    return rawPickProject(projects, needle ?? undefined);
  } catch (error) {
    throw new Error(String(error));
  }
}

// --- projects ---
/**
 * Project rules (Rust `projects`), re-exported from index.ts.
 */
/** The trimmed project name, or undefined when it is blank. */
export function projectName(name: string): string | undefined {
  return rawProjectName(name) ?? undefined;
}

// --- proposal-apply ---
/**
 * Proposal-apply check (Rust `ai::proposal_apply::proposal_applies`), re-exported from index.ts.
 */
/** Whether a proposal written against `expectedRevision` still applies to a row at `storedUpdatedAt`. */
export function proposalApplies(storedUpdatedAt: string | null | undefined, expectedRevision?: string | null): boolean {
  return rawProposalApplies(storedUpdatedAt ?? undefined, expectedRevision ?? undefined);
}

// --- proposal-groups ---
/**
 * AI review queue grouping (Rust `proposal_groups`), re-exported from index.ts.
 * Returns indices into the input list; the caller maps them back to its rows.
 * The shapes come from bindings.ts, generated from the Rust types.
 */
/**
 * Groups in the order their first proposal appears. By `"document"`, a resource id not in
 * `knownIds` (a create's fresh id, or a target not in the catalog) is grouped under
 * `kind:<kind>` instead.
 */
export function groupProposals(
  items: readonly ProposalRef[],
  by: "document" | "kind",
  knownIds?: readonly string[],
): ProposalGroup[] {
  return rawGroupProposals(items, by, knownIds ? [...knownIds] : undefined) as ProposalGroup[];
}

// --- proposal-inputs ---
/**
 * AI write-proposal payload readers (Rust `ai::proposal_inputs`), re-exported from index.ts.
 * Keeps the messages of apps/web/src/features/ai-assistant/application/parts.ts.
 * A refused payload throws an Error with that message.
 */
/**
 * Experiment update: status, metrics and artifacts. Generic until the Rust type carries specta
 * bindings (the metrics object is free-form), as the model-concept wrappers are.
 */
export function proposalExperimentUpdate<Update>(payload: unknown): Update {
  return rawExperimentUpdate(payload) as Update;
}

// --- quick-open ---
/**
 * Quick open ranking and palette groups (Rust `editor_workspace::quick_open`),
 * re-exported from index.ts. The Enter-to-pick check stays with the dialog,
 * since it reads keyboard composition state and is not part of the ranking.
 */
export type { QuickOpenGroup, QuickOpenResult };

// --- reader-analysis-bibliography ---
/**
 * Bibliography parsing (Rust `reader_analysis::bibliography`), re-exported from index.ts. Each function keeps
 * the signature and defaults of the TypeScript parser it replaced.
 * Object shapes come from ./bindings.ts.
 */
/** Entry number from the regex exec groups `[whole, g1..g5]`: the first set of `g2..g5`. */
export function labelNumber(groups: readonly (string | undefined)[]): number {
  return rawLabelNumber(groups);
}

// --- reader-analysis-citations ---
/**
 * Citation candidates and pattern mentions (Rust `reader_analysis::citations`), re-exported from index.ts. Each
 * function keeps the signature and defaults of
 * CitationsFns in packages/core/src/shared/core-contract.ts. Object shapes come from ./bindings.ts.
 */
/** Citation mentions on one page that name bibliography entries, sorted by start. */
export function findPatternCitationMentions(
  page: { number: number; text: string; items: readonly AnalysisPdfItem[] },
  refs: readonly AnalysisParsedReference[],
  excluded: readonly AnalysisPageTextRange[] = [],
  candidates: readonly CitationCandidate[] = rawFindCitationCandidates(page.items),
): AnalysisCitationMention[] {
  return rawFindPatternCitationMentions(page, refs, excluded, candidates) as AnalysisCitationMention[];
}

// --- reader-analysis-document ---
/**
 * The full PDF analysis pass (Rust `reader_analysis::document_analysis`), re-exported from index.ts.
 * Keeps the signature and default of packages/core/src/features/reader/analysis/document-analysis.ts.
 * Object shapes come from ./bindings.ts.
 */
/**
 * Lines, columns, sections, bibliography, citations, figure mentions and a fingerprint for the
 * pages. `outline` is the PDF's own bookmarks; empty means sections come from the headings.
 */
export function analyzePdfDocument(
  pages: readonly AnalysisPdfPage[],
  outline: readonly OutlineReaderItem[] = [],
): DocumentAnalysis {
  return rawAnalyzePdfDocument(pages, outline) as DocumentAnalysis;
}

// --- reader-analysis-lines ---
/**
 * Text lines, column detection and running-head keys (reader analysis), backed
 * by Rust. Offsets are UTF-16 code units, as in the TS copy. Rust returns column
 * and reading-order indices; `sortByReadingOrder` maps them back to the caller's
 * objects. The `keep` predicate of `reconstructLines` runs here, in TS, and its
 * per-run verdicts cross to Rust as flags.
 */
/**
 * One page's runs as lines, in the page's own order (Rust `reconstruct_lines`).
 * `keep` is applied to each non-blank run, as the TS copy did.
 */
export function reconstructLines(
  page: number,
  items: readonly { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean; fontName?: string }[],
  keep: (item: { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean; fontName?: string }) => boolean = () => true,
): TextLine[] {
  const flags = items.map((item) => !!item.str.trim() && keep(item));
  return rawReconstructLines(page, items, flags) as TextLine[];
}

/**
 * Reading order over column-tagged lines: page, then column, then top to bottom.
 * Returns the caller's own line objects (Rust `sort_by_reading_order_indices`).
 */
export function sortByReadingOrder<T extends TextLine>(
  tagged: readonly { line: T; column: number }[],
): T[] {
  const order = rawSortByReadingOrderIndices(tagged) as number[];
  return order.map((index) => tagged[index]!.line);
}

// --- reader-analysis-outline ---
/**
 * Outline-from-text helpers (Rust `reader_analysis::outline`), re-exported from index.ts. Each function keeps
 * the signature and defaults of packages/core/src/features/reader/outline-from-text.ts. Object shapes come from ./bindings.ts.
 *
 * `groupRecurringLines` is generic over the caller's objects, so the Rust side works on indices and this
 * wrapper maps them back to the caller's objects.
 */
/** Group lines by (near-)identical text. Members keep the caller's objects. */
export function groupRecurringLines<T>(
  lines: readonly T[],
  textOf: (line: T) => string,
  pageOf: (line: T) => number,
): { key: string; pages: Set<number>; members: T[] }[] {
  const groups = rawGroupRecurringLines(
    lines.map((line) => textOf(line)),
    lines.map((line) => pageOf(line)),
  ) as OutlineRecurringGroupIndices[];
  return groups.map((group) => ({
    key: group.key,
    // f64 crosses as `number | null` in the bindings; these are always finite.
    pages: new Set(group.pages as number[]),
    members: (group.members as number[]).map((index) => lines[index]!),
  }));
}

// --- reader-analysis-structure ---
/**
 * Page-structure helpers (Rust `reader_analysis`: reference section, figures, running heads,
 * headings, citations), re-exported from index.ts. Each function keeps the behaviour of the
 * TypeScript function it replaced. Object shapes come from ./bindings.ts.
 */
/**
 * The bibliography's span over `lines`, or `null` when there is none. `furniture` flags the lines
 * that are running heads or folios; they never count as entries.
 */
export function findReferenceSection(
  lines: readonly AnalysisTextLine[],
  bodyFontSize: number,
  pageCount: number,
  furniture?: readonly boolean[] | null,
): ReferenceSectionSpan | null {
  return rawFindReferenceSection(lines, bodyFontSize, pageCount, furniture ?? null) as
    | ReferenceSectionSpan
    | null;
}

/** Figure and table mentions across the pages. `outline` is optional. */
export function findFigureMentions(
  pages: readonly FigurePage[],
  outline?: readonly OutlineReaderItem[] | null,
): FigureMention[] {
  return rawFindFigureMentions(pages, outline ?? null) as FigureMention[];
}

/** Heading lines in `lines`. `furniture` flags the lines that never count as headings. */
export function findHeadingLines(
  lines: readonly AnalysisTextLine[],
  body: number,
  furniture: readonly boolean[],
): AnalysisTextLine[] {
  const furnitureIndices = furniture.flatMap((isFurniture, index) => (isFurniture ? [index] : []));
  return rawFindHeadingLines(lines, body, furnitureIndices) as AnalysisTextLine[];
}

/** True when a PDF named destination is a citation target (a bibliography or reference anchor). */
export function isCitationDestination(name: string | null | undefined): boolean {
  return rawIsCitationDestination(name ?? null);
}

/** One page's citations: native link mentions, pattern mentions and text candidates, assembled. */
export function assemblePageCitations(
  page: AnalysisPdfPage,
  native: readonly AnalysisCitationMention[],
  patterns: readonly AnalysisCitationMention[],
  excluded: readonly AnalysisPageTextRange[],
  candidates?: readonly CitationCandidate[] | null,
): AnalysisCitationMention[] {
  return rawAssemblePageCitations(page, native, patterns, excluded, candidates ?? null) as AnalysisCitationMention[];
}

// --- reader-analysis-text ---
/**
 * Citation text helpers (Rust `reader_analysis::text`), re-exported from index.ts. Each function keeps
 * the signature and defaults of CitationTextFns, TextFingerprintFns and TitleSimilarityFns in\n * packages/core/src/shared/core-contract.ts. Object shapes come from ./bindings.ts.
 *
 * `itemToRect` is exported here as `citationItemToRect`: that name is taken by another lane.
 */
/** The PDF rect `[x0, y0, x1, y1]` of `item.str[from..to]`, or null. */
export function citationItemToRect(item: AnalysisPdfItem, from = 0, to = item.str.length): number[] | null {
  return rawCitationItemToRect(item, from, to) as number[] | null;
}

// --- reader-anchor ---
/**
 * Text and geometry anchor resolution (`packages/core/src/reader/anchor-*`), backed by
 * Rust. Offsets are UTF-16 code units, as in the TS copy. Re-exported from index.ts.
 */
/**
 * Collapse whitespace runs to one space; `map[i]` is the original offset of
 * normalised unit `i`, and `map[normalised.length]` the exclusive end (Rust `normalise_whitespace`).
 */
export function normaliseWhitespace(
  text: string,
  options: { trim?: boolean } = {},
): { normalised: string; map: number[] } {
  return rawNormaliseWhitespace(text, options) as { normalised: string; map: number[] };
}

/** Every exact occurrence of `quote.exact` whose prefix/suffix match (Rust `find_quote_matches`). */
export function findQuoteMatches(text: string, quote: AnchorQuoteSelector): { start: number; end: number }[] {
  return rawFindQuoteMatches(text, quote) as { start: number; end: number }[];
}

/** The match nearest `position.start`; the first on ties (Rust `pick_nearest_match`). */
export function pickNearestMatch(
  matches: readonly AnchorTextSpan[],
  position: AnchorPositionSelector | undefined,
): { start: number; end: number } | undefined {
  return (rawPickNearestMatch(matches, position) ?? undefined) as { start: number; end: number } | undefined;
}

/** The position span when in bounds and ordered, else `null` (Rust `resolve_position_selector`). */
export function resolvePositionSelector(
  text: string,
  position: AnchorPositionSelector,
): { start: number; end: number } | null {
  return rawResolvePositionSelector(text, position) as { start: number; end: number } | null;
}

/** Quote first, then position fallback; `null` when neither works (Rust `resolve_text_anchor`). */
export function resolveTextAnchor(text: string, locus: AnchorPdfLocus): { start: number; end: number; via: AnchorVia; confidence: AnchorConfidence } | null {
  return rawResolveTextAnchor(text, locus) as { start: number; end: number; via: AnchorVia; confidence: AnchorConfidence } | null;
}

/** Which anchor to trust for the current PDF (Rust `choose_anchor_strategy`). */
export function chooseAnchorStrategy(
  anchor: AnchorCombinedPdf,
  currentContentHash: string,
): AnchorStrategy {
  const strategy = rawChooseAnchorStrategy(anchor, currentContentHash) as AnchorStrategy;
  // Hand back the caller's own objects, as the TS copy does, so unknown fields survive.
  if (strategy.kind === "rects") return { ...strategy, position: anchor.zoteroPosition! };
  if (strategy.kind === "quote") return { ...strategy, locus: anchor.locus! };
  return strategy;
}

// --- reader-annotation ---
/**
 * Reader annotation type guards and keyboard command mapping (step 5-2e),
 * re-exported from index.ts. The command type comes from ./bindings.ts; the
 * guards take any string and narrow it to the TS annotation unions inline.
 */
/**
 * Whether an event target owns its keystrokes: a text field, a select or its
 * option, or anything contenteditable (Rust `is_editable_reader_target`).
 */
export function isEditableReaderTarget(
  target: EventTarget | { tagName?: unknown; isContentEditable?: unknown } | null | undefined,
): boolean {
  if (!target) return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  const tag = typeof el.tagName === "string" ? el.tagName : undefined;
  return rawIsEditableReaderTarget(tag, Boolean(el.isContentEditable));
}

/**
 * Return a command for navigable keys, or null when the event should pass through
 * (Rust `reader_keyboard_command`). Editable and Alt events always pass through.
 */
export function readerKeyboardCommand(event: {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** True when the event target is an editable field. */
  fromEditable?: boolean;
}): ReaderKeyboardCommand | null {
  return rawReaderKeyboardCommand({
    key: event.key,
    code: event.code,
    ctrlKey: Boolean(event.ctrlKey),
    metaKey: Boolean(event.metaKey),
    altKey: Boolean(event.altKey),
    fromEditable: Boolean(event.fromEditable),
  }) as ReaderKeyboardCommand | null;
}

// --- reader-annotation-geometry ---
/**
 * Annotation geometry per page (Rust `reader::annotation_geometry`), re-exported
 * from index.ts. The input, bucket and geometry types come from ./bindings.ts.
 */
/**
 * Annotations grouped by 1-based page number, in first-insertion order. The raw
 * core returns index buckets; this rebuilds the Map the reader's callers expect.
 */
export function bucketAnnotationsByPage(
  annotations: readonly ReaderAnnotation[],
): Map<number, ReaderAnnotation[]> {
  const buckets = rawBucketAnnotationsByPage(annotations) as PageBucket[];
  const byPage = new Map<number, ReaderAnnotation[]>();
  for (const bucket of buckets) {
    byPage.set(
      bucket.pageNumber ?? 0,
      bucket.annotationIndices.map((i) => annotations[i] as ReaderAnnotation),
    );
  }
  return byPage;
}
