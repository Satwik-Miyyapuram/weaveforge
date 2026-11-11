/**
 * Typed wrappers over the raw wasm exports, folded from 22 one-module files:
 * dashboard-packing, document-stats, duplicate-note, embedding-models, enum-label, eraser-sweep,
 * error-report, experiment-artifacts, experiment-status, explorer-edit, explorer-state, figure,
 * git-auth, graph-build, graph-palette, graph-settings, graph-sizing, graph-timeline,
 * graph-topology, hit-test, hybrid-fusion, outline.
 */
import {
  buildGraphData as rawBuildGraphData,
  coveredHitMask,
  creationKindFor as rawCreationKindFor,
  creationTarget as rawCreationTarget,
  cropFigureTo as rawCropFigureTo,
  dashboardLayoutFloors as rawLayoutFloors,
  duplicatePlan as rawDuplicatePlan,
  EraserSweepState as RawEraserSweepState,
  fitLayoutToContent as rawFitLayoutToContent,
  formatCursorLabel as rawFormatCursorLabel,
  formatMetricCell as rawFormatMetricCell,
  gateVectorMask,
  gitRemoteAuth as rawGitRemoteAuth,
  graphFilterCountFor as rawGraphFilterCountFor,
  graphPalette as rawGraphPalette,
  graphTopologyKey as rawGraphTopologyKey,
  inkPageFigures as rawInkPageFigures,
  inkPolygonBounds as rawInkPolygonBounds,
  isSectionOpen as rawIsSectionOpen,
  isStaleRunningExperiment as rawIsStaleRunningExperiment,
  keepFigureOnPage as rawKeepFigureOnPage,
  labelSize as rawLabelSize,
  maxReportChars,
  metricKeys as rawMetricKeys,
  migratedExpanded as rawMigratedExpanded,
  parseFigureCrop as rawParseFigureCrop,
  parseFigureTokens as rawParseFigureTokens,
  planEmbeddingStart as rawPlanEmbeddingStart,
  redactReport,
  redactReportAndCap,
  reorderFigureIndices as rawReorderFigureIndices,
  resizeFigureBox as rawResizeFigureBox,
  statusPatchForExperiment as rawStatusPatchForExperiment,
  timelineLaneOffset,
  timelineMidYear,
  toggleExpanded as rawToggleExpanded,
  toggleSection as rawToggleSection,
  withInkPageFigures as rawWithInkPageFigures,
  withStoredHeights as rawStoredHeights,
} from "../pkg/wf_wasm.js";
import type {
  CardLimit,
  CreateKind,
  CreationTarget,
  DraftMakes,
  DuplicatePlan,
  DuplicateSource,
  EditableRoot,
  EnumOption,
  Experiment,
  ExperimentStatus,
  ExperimentStatusPatch,
  FigureBox,
  FigureHandle,
  FigureOrderStep,
  FigurePlacement,
  FigureRect,
  GraphBuildExperiment,
  GraphBuildList,
  GraphBuildNote,
  GraphBuildPaper,
  GraphBuildSection,
  GraphLink,
  GraphNode,
  GraphViewSettings,
  LabelSize,
  LayoutItem,
  NodeSize,
  OutlineHeading,
  PaperRelation,
  Redacted,
  ReportMarkdown,
  ResultsTable,
} from "./bindings.js";

export {
  artifactKind,
  bodyStats,
  canDrop,
  canRename,
  coveredHitMask,
  creatableUnder,
  dashboardCloseGaps,
  dashboardCompactVertical,
  dashboardNormalizeItem,
  dashboardPackSm,
  defaultExpanded,
  defaultGraphSettings,
  defaultOpenSections,
  distanceToSegmentSquared,
  draftIcon,
  draftMakes,
  draftPlaceholder,
  dropParentId,
  effectiveRelationTypes,
  enumLabel,
  enumOptions,
  experimentActivityAt,
  experimentHref,
  experimentsListHref,
  figureAltFor,
  figureCornerHit,
  figureImageFrame,
  formatCount,
  formatCursorLabel,
  formatFigureTokens,
  formatMetricValue,
  formatWords,
  gateVectorMask,
  gitBasicAuth,
  graphFilterCountFor,
  humanise,
  incomingRelationLabel,
  inkLassoKeeps,
  inkPointInPolygon,
  inkStrokeNearSegment,
  isAbsoluteEntry,
  isAbsoluteUrl,
  isNetworkFailure,
  maxReportChars,
  metricKeys,
  newIssueUrl,
  nodeSize,
  normalizeGraphViewSettings,
  outlineOf,
  parseExplorerKeys,
  parseGraphPersistedState,
  queryTermCount,
  redactReport,
  redactReportAndCap,
  reportMarkdown,
  resultsTable,
  rootKey,
  rootOf,
  rootOfKind,
  rowsForHeight,
  safeName,
  shortSha,
  showConceptEdges,
  showRelationEdges,
  stripStopwords,
  tagColor,
  timelineLaneOffset,
  timelineMidYear,
  uncroppedFigureBox,
  viewableArtifactUrl,
  yearSpacing,
} from "../pkg/wf_wasm.js";
export type {
  CardLimit as DashboardPackingLimit,
  EnumOption,
  GraphBuildExperiment,
  GraphLink as GLink,
  LayoutItem as DashboardPackingItem,
  Redacted as RedactionOutcome,
  ReportMarkdown as ReportMarkdownInput,
  ResultsTable,
} from "./bindings.js";

// --- dashboard-packing ---
/**
 * Dashboard grid packing (Rust `dashboard::packing`) and fitted list-card heights (Rust `dashboard::fit`).
 * Card limits are passed in as data.
 * The item and limit types come from ./bindings.js. An unknown card type throws.
 */
/** One card type's size limits (Rust `CardLimit`). */

/** One card placed on the grid (Rust `LayoutItem`). */

/** Min and max size of a card on a grid `cols` wide. */
export function dashboardLayoutFloors(
  limit: CardLimit,
  cols: number,
): { minW: number; minH: number; maxW: number; maxH: number } {
  return rawLayoutFloors(limit, cols) as ReturnType<typeof dashboardLayoutFloors>;
}

/** The layout as viewed: fitting cards take their measured rows (Rust `fit_layout_to_content`). */
export function fitLayoutToContent(
  items: readonly LayoutItem[],
  measured: ReadonlyMap<string, number>,
  maxHeights: Readonly<Record<string, number>>,
): LayoutItem[] {
  return rawFitLayoutToContent(items, Object.fromEntries(measured), maxHeights) as LayoutItem[];
}

/** Each position's height, with the saved height put back where the card has one. */
export function withStoredHeights<T extends { i: string; h: number }>(
  rgl: readonly T[],
  stored: readonly LayoutItem[],
): T[] {
  const heights = rawStoredHeights(
    rgl.map((r) => r.i),
    rgl.map((r) => r.h),
    stored,
  ) as number[];
  return rgl.map((r, k) => ({ ...r, h: heights[k]! }));
}

// --- document-stats ---
/**
 * The status bar's document numbers (Rust `editor_workspace::document_stats`),
 * re-exported from index.ts.
 */
/** "Ln 7, Col 4". */
export function formatCursor(cursor: { line: number; col: number }): string {
  return rawFormatCursorLabel(cursor.line, cursor.col);
}

// --- duplicate-note ---
/**
 * The plan for a duplicate note (Rust `editor_workspace::duplicate_note`),
 * re-exported from index.ts.
 */
export type { DuplicatePlan, DuplicateSource };

/**
 * What to create for a duplicate, or `null` when the document is not a note or
 * its body is still the preview.
 */
export function duplicatePlan(
  doc: DuplicateSource | null | undefined,
  documents: readonly DuplicateSource[],
): DuplicatePlan | null {
  return rawDuplicatePlan(doc ?? null, documents);
}

// --- embedding-models ---
/**
 * Embedding-encoder start plan (Rust `embedding_models`). Decides whether stored
 * vectors are reused, swapped for a known encoder, or rebuilt.
 */
/** `reuse` (same encoder), `swap` (known other encoder), or `rebuild` (nothing usable stored). */
export function planEmbeddingStart(
  storedModel: string | null,
  target: string,
): "reuse" | "swap" | "rebuild" {
  return rawPlanEmbeddingStart(storedModel ?? undefined, target) as "reuse" | "swap" | "rebuild";
}

// --- enum-label ---
/**
 * Human labels for enum values (Rust `enum_label`), re-exported from index.ts.
 */
/** The enum kinds that have fixed labels. */
/** Narrowing: pure TS literal union, no Rust enum counterpart. */
export type EnumKind = "paperStatus" | "milestoneStatus" | "experimentStatus" | "relation" | "dependency" | "shareAccess";

// --- eraser-sweep ---
/**
 * One erase sweep (Rust `ink::eraser_sweep`): which pointer sweeps, and the
 * eraser cursor action each transition asks for. The cursor itself is a DOM
 * style, so the caller applies the action to the element it tracks.
 */
/** What the caller does to the eraser cursor: nothing, show it, keep it, or restore the saved one. */
export type CursorActionName = "none" | "show" | "keep" | "restore";

/** The erase sweep's state (Rust `EraserSweepState`), down to up. */
export class EraserSweepState {
  private readonly raw = new RawEraserSweepState();

  /** Starts a sweep; `penEraser` is whether the pointer is the pen's eraser end. */
  begin(pointerId: number, toolErases: boolean, tipErases: boolean, penEraser: boolean): CursorActionName {
    return this.raw.begin(pointerId, toolErases, tipErases, penEraser) as CursorActionName;
  }

  /** Whether `pointerId` is the one sweeping. */
  owns(pointerId: number): boolean {
    return this.raw.owns(pointerId);
  }

  /** Ends the sweep `pointerId` owns. */
  end(pointerId: number): CursorActionName {
    return this.raw.end(pointerId) as CursorActionName;
  }

  /** A hover by `pointerId`. */
  hover(pointerId: number): CursorActionName {
    return this.raw.hover(pointerId) as CursorActionName;
  }

  /** The pointer `pointerId` left the surface. */
  leave(pointerId: number): CursorActionName {
    return this.raw.leave(pointerId) as CursorActionName;
  }

  /** A down by `pointerId` that did not erase. */
  release(pointerId: number): CursorActionName {
    return this.raw.release(pointerId) as CursorActionName;
  }
}

// --- error-report ---
/**
 * Error reports (Rust `error_report`): redaction, and the prefilled "new issue"
 * address and body. Re-exported from index.ts.
 */
/** Redacted text and how many spans were replaced (generated `Redacted`). */
/** The fields of an issue body (generated `ReportMarkdown`). */

/** Redacts every sensitive span in `input` (same as `redactReport`). */
export function redact(input: string): Redacted {
  return redactReport(input);
}

/**
 * Redacts, then keeps the result to `limit` UTF-16 units, announcing any cut
 * (Rust `redact_and_cap`). The default is Rust's `MAX_REPORT_CHARS`.
 */
export function redactAndCap(input: string, limit: number = maxReportChars()): Redacted {
  return redactReportAndCap(input, Math.max(0, Math.floor(limit)));
}

// --- experiment-artifacts ---
/**
 * Experiment artifact names and view URLs (Rust `experiment_artifacts`), re-exported from index.ts.
 * Each function keeps the signature of apps/web/src/features/experiments/infrastructure/experiment-artifact-store.ts.
 */
/** How a stored entry is shown: an image, a PDF, or a link. */
export type ArtifactKind = "image" | "pdf" | "link";

// --- experiment-status ---
/**
 * Experiment status and metric display helpers (Rust `experiment_status`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/features/experiments/domain/parts.ts.
 */
/** The statuses that end a run (TS `TERMINAL_EXPERIMENT_STATUSES`). */
export const TERMINAL_EXPERIMENT_STATUSES: readonly ExperimentStatus[] = ["done", "failed", "abandoned"];

/** Running experiments with no finish and no activity this long are treated as dead. */
export const STALE_RUNNING_MS = 2 * 60 * 1000;

export function statusPatchForExperiment(
  experiment: Experiment,
  status: ExperimentStatus,
  now: string,
): ExperimentStatusPatch {
  const patch = rawStatusPatchForExperiment(experiment, status, now) as ExperimentStatusPatch;
  // Every key is present, so spreading the patch clears a stamp Rust left out.
  return { status: patch.status, startedAt: patch.startedAt ?? undefined, finishedAt: patch.finishedAt ?? undefined };
}

export function isStaleRunningExperiment(
  experiment: Experiment,
  nowMs: number = Date.now(),
  staleMs: number = STALE_RUNNING_MS,
  lastMetricAtMs?: number,
): boolean {
  return rawIsStaleRunningExperiment(experiment, nowMs, staleMs, lastMetricAtMs);
}

/** One metric's value as text, for a chip or a table cell. */
export function formatMetricCell(_metric: string, value: unknown): string {
  // serde has no bigint; `String(bigint)` is the text the TS version produced.
  if (typeof value === "bigint") return value.toString();
  if ((typeof value === "object" && value !== null) || typeof value === "function" || typeof value === "symbol") {
    // Rust sees plain JSON, so JSON.stringify's own rules (toJSON, dropped undefined,
    // cycles) run here first, as they did in TS.
    let json: string | undefined;
    try {
      json = JSON.stringify(value);
    } catch {
      return "—";
    }
    if (json === undefined) return "—";
    const plain: unknown = JSON.parse(json);
    // A toJSON that returned a primitive: TS showed the JSON text itself.
    return typeof plain === "object" && plain !== null ? rawFormatMetricCell(_metric, plain) : json;
  }
  return rawFormatMetricCell(_metric, value);
}

/** Every metric name any of the runs logged, sorted by UTF-16 code units. */
export function metricKeysOf(experiments: readonly Experiment[]): string[] {
  return rawMetricKeys(experiments);
}

// --- explorer-edit ---
/**
 * Explorer create, rename and move rules (Rust `editor_workspace::explorer_edit`),
 * re-exported from index.ts. The drag MIME type is a UI constant and lives with the panel.
 */
export type { CreateKind, DraftMakes, EditableRoot };

/** A draft row: what it will make and where it sits. */
export interface Draft {
  kind: CreateKind;
  root: EditableRoot;
  /** The parent note or section; `null` puts it at the root. */
  parentId: string | null;
}

/** The kind the "new file" gestures make for the document on screen. */
export function creationKindFor(active: { kind: string } | undefined): CreateKind {
  return rawCreationKindFor(active?.kind);
}

/** Where a "new file" lands: the folder of the document on screen, or the root. */
export function creationTarget(
  kind: CreateKind,
  active: { kind: string; id: string; parentId?: string } | undefined,
  folders: ReadonlySet<string>,
): CreationTarget {
  const doc = active ? { kind: active.kind, parentId: active.parentId ?? null } : null;
  return rawCreationTarget(kind, doc, [...folders]);
}

// --- explorer-state ---
/**
 * Explorer open-row and open-section rules (Rust `editor_workspace::explorer_state`).
 * The Rust side takes arrays; these wrappers keep the `Set` signatures the panel uses.
 */
/** Which sections are open. Anything not in the set is closed. */
export interface SectionState {
  open: ReadonlySet<string>;
}

/** The saved keys plus any root the record never mentioned. Saved keys win. */
export function migratedExpanded(saved: ReadonlySet<string>, roots: readonly string[]): Set<string> {
  return new Set<string>(rawMigratedExpanded([...saved], [...roots]));
}

/** Expanded rows with `key` flipped. Returns a new set; never mutates. */
export function toggleExpanded(expanded: ReadonlySet<string>, key: string): Set<string> {
  return new Set<string>(rawToggleExpanded([...expanded], key));
}

/** Open or close one section, touching no other. */
export function toggleSection(state: SectionState, id: string): SectionState {
  return { open: new Set<string>(rawToggleSection([...state.open], id)) };
}

export function isSectionOpen(state: SectionState, id: string): boolean {
  return rawIsSectionOpen([...state.open], id);
}

// --- figure ---
/**
 * Placed figures on an ink page (Rust `ink::figure`), re-exported from index.ts:
 * the `x= y= w= h= c=` tokens in an image alt, the figure block of a page's
 * text, and the box maths for moving, resizing and cropping a figure. Callers
 * get the narrow number types through `FigureFns` in the core contract.
 */
/** Drops a `crop` the Rust side left out, so the object compares like the old one. */
function withCrop<T extends { crop?: unknown }>(one: T): T {
  if (one.crop == null) delete one.crop;
  return one;
}

/** Just the box of `one`, so extra fields never reach serde. */
function rectOf(one: FigureRect): FigureRect {
  return { x: one.x, y: one.y, w: one.w, h: one.h };
}

/** The geometry tokens in an image alt, or `null` when the box is not complete. */
export function parseFigureTokens(alt: string): FigureBox | null {
  const one = rawParseFigureTokens(alt) as FigureBox | null;
  return one ? withCrop(one) : null;
}

/** A `c=l,t,r,b` value as crop insets clamped to 0..99; undefined when it is not four numbers. */
export function parseFigureCrop(raw: string): FigureBox["crop"] | undefined {
  return (rawParseFigureCrop(raw) as FigureBox["crop"]) ?? undefined;
}

/** The box moved so at least half of it stays on the page; the same object when it already fits. */
export function keepFigureOnPage<T extends FigureRect>(
  one: T,
  pageSize: { width: number; height: number },
): T {
  const [x, y] = rawKeepFigureOnPage(rectOf(one), pageSize.width, pageSize.height);
  return x === one.x && y === one.y ? one : { ...one, x, y };
}

/** The figures a page's text places, in line order. */
export function inkPageFigures(text: string): FigurePlacement[] {
  return (rawInkPageFigures(text) as FigurePlacement[]).map(withCrop);
}

/** A page's text with its figure block set: after the background line, before the text. */
export function withInkPageFigures(text: string, figures: readonly FigurePlacement[]): string {
  return rawWithInkPageFigures(
    text,
    figures.map(({ path, x, y, w, h, crop }) => ({ path, x, y, w, h, ...(crop ? { crop } : {}) })),
  );
}

/** The new order of `len` figures as old indices, with the one at `index` moved by `step`. */
export function reorderFigureIndices(len: number, index: number, step: FigureOrderStep): number[] {
  return Array.from(rawReorderFigureIndices(len, index, step));
}

/** The figures with the one at `index` moved; "front" is the end of the array. */
export function reorderFigures<T>(figures: readonly T[], index: number, step: FigureOrderStep): T[] {
  return reorderFigureIndices(figures.length, index, step).map((from) => figures[from]!);
}

/** A box resized by dragging `handle`; a corner keeps the aspect unless `free`; no side under `min` (30). */
export function resizeFigureBox(
  box: FigureRect,
  handle: FigureHandle,
  dx: number,
  dy: number,
  options: { free?: boolean; min?: number } = {},
): FigureRect {
  return rawResizeFigureBox(
    rectOf(box),
    handle,
    dx,
    dy,
    options.free ?? false,
    options.min ?? 30,
  ) as FigureRect;
}

/** A figure re-cropped to `kept` inside the uncropped image `full`; keeping everything clears the crop. */
export function cropFigureTo(full: FigureRect, kept: FigureRect): FigureBox {
  return withCrop(rawCropFigureTo(rectOf(full), rectOf(kept)) as FigureBox);
}

// --- git-auth ---
/**
 * Git remote credentials (Rust `sync::git_auth`), re-exported from feature-wrappers.ts.
 * Keeps spawning git and merging `process.env` in apps/shell/sidecar/src/vault-git.ts.
 */
export interface GitRemoteAuthInput {
  /** The remote URL as stored. */
  url: string;
  /** The access token. Empty or absent sends no credentials. */
  token?: string;
  /** The user name paired with the token. Absent uses `x-access-token`. */
  username?: string;
}

export interface GitRemoteAuthPlan {
  /** Arguments to put before the git subcommand. */
  flags: string[];
  /** Environment keys to set on top of `process.env`. */
  env: Record<string, string>;
}

/** The git flags and environment overrides for one remote command. */
export function gitRemoteAuth(input: GitRemoteAuthInput): GitRemoteAuthPlan {
  return rawGitRemoteAuth(input) as GitRemoteAuthPlan;
}

// --- graph-build ---
/**
 * Citation-graph builder (Rust `graph_build`), re-exported from index.ts.
 * Keeps the signature of apps/web/src/features/relations/application/build-graph-data.ts.
 * Maps and Sets are converted here, so the wasm side only sees plain objects and arrays.
 */
/** A graph node, with the layout fields the force graph writes in place. */
/** Narrowing: extends generated GraphNode with force-layout fields (x, y, fx, fy). */
export type GNode = GraphNode & { x?: number; y?: number; fx?: number; fy?: number };

/** One graph view and its lookups. */
/** Narrowing: Maps and Sets here; wasm returns plain records. */
export interface GraphBuildOutput {
  data: { nodes: GNode[]; links: GraphLink[] };
  /** Node id to the ids it is linked to. */
  neighbors: Map<string, Set<string>>;
  /** Tag to the papers that carry it or sit in a list of that name. */
  tagToPapers: Map<string, string[]>;
  /** Tag to the notes that carry it or sit in a list of that name. */
  tagToNotes: Map<string, string[]>;
}

/** Builds nodes, links and lookups for one graph view. */
export function buildGraphData(
  papers: GraphBuildPaper[],
  relations: PaperRelation[],
  settings: GraphViewSettings,
  membership: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
  lists: GraphBuildList[] = [],
  notes: GraphBuildNote[] = [],
  sections: GraphBuildSection[] = [],
  experiments: GraphBuildExperiment[] = [],
): GraphBuildOutput {
  const raw = rawBuildGraphData({
    papers,
    relations,
    settings,
    membership: Object.fromEntries([...membership].map(([id, set]) => [id, [...set]])),
    lists,
    notes,
    sections,
    experiments,
  }) as {
    data: { nodes: GNode[]; links: GraphLink[] };
    neighbors: Record<string, string[]>;
    tagToPapers: Record<string, string[]>;
    tagToNotes: Record<string, string[]>;
  };
  return {
    data: raw.data,
    neighbors: new Map(Object.entries(raw.neighbors).map(([id, ids]) => [id, new Set(ids)])),
    tagToPapers: new Map(Object.entries(raw.tagToPapers)),
    tagToNotes: new Map(Object.entries(raw.tagToNotes)),
  };
}

// --- graph-palette ---
/**
 * Graph palette and tag colours (Rust `graph_colour`), re-exported from index.ts.
 * Keeps the names of apps/web/src/features/relations/domain/graph-palette.ts.
 */
/** Every fixed colour the citation graph draws. */
/** Narrowing: relation and readingStatus are Record<string,string>; Rust uses nested structs. */
export interface GraphPalette {
  /** Edge colour per relation type, keyed by snake_case relation name. */
  relation: Record<string, string>;
  /** Node colour per reading status. */
  readingStatus: Record<string, string>;
  note: string;
  paper: string;
  wikilink: string;
  report: string;
  experiment: string;
  experimentLink: string;
  uncoloured: string;
  rampGradient: string;
  /** Community colours, biggest first. */
  cluster: string[];
}

/** The fixed palette. Needs the wasm core loaded. */
export function graphPalette(): GraphPalette {
  return rawGraphPalette() as GraphPalette;
}

// --- graph-settings ---
/**
 * Graph view settings (Rust `relations::graph_settings`), re-exported from index.ts. Each
 * function keeps the signature of packages/core/src/features/relations/domain/
 * graph-view-settings.ts and graph-persisted-state.ts.
 */
export function graphFilterCount(
  selectedTags: string[],
  selectedLists: string[],
  settings: GraphViewSettings,
): number {
  return rawGraphFilterCountFor(selectedTags.length, selectedLists.length, settings);
}

// --- graph-sizing ---
/**
 * Graph node and label sizes at a zoom (Rust `relations::graph_sizing`), re-exported from index.ts.
 * Sizes are in graph units; every stroke is a fraction of the drawn size, so an outline never
 * outgrows its node. Types come from ./bindings.js.
 */
export type { LabelSize, NodeSize };

/** How big a label draws at `zoom`. `kind === "tag"` picks the tag label's base size. */
export function labelSize(kind: string, zoom: number, bounded = true): LabelSize {
  return rawLabelSize(kind === "tag", zoom, bounded) as LabelSize;
}

// --- graph-timeline ---
/**
 * Timeline layout lanes (Rust `relations::graph_timeline`), re-exported from index.ts.
 * Keeps the signatures of apps/web/src/features/relations/application/graph-timeline.ts.
 */
/**
 * The timeline layout: each node's x is fixed to its publication year, centred on the
 * mean year of the collection. Nodes without a year get `null` and are left to the forces.
 * Returns `null` when the layout is not `"timeline"` or no node has a year.
 */
export function timelineLaneX(
  layout: string,
  nodes: readonly { year?: number | null }[],
): ((node: { year?: number | null }) => number | null) | null {
  const mid = timelineMidYear(layout, nodes.map((n) => n.year ?? null));
  if (mid === null) return null;
  return (node) => timelineLaneOffset(mid, node.year ?? undefined);
}

// --- graph-topology ---
/**
 * Graph simulation restart key (Rust `relations::graph_topology`),
 * re-exported from index.ts.
 */
/** What the simulation is laid out over; a change to the returned key restarts it. */
export function graphTopologyKey(
  shown: { nodes: readonly { id: string }[]; links: readonly { id: string }[] },
  localSeed: string | null,
  localDepth: number,
): string {
  return rawGraphTopologyKey(shown, localSeed ?? undefined, localDepth);
}

// --- hit-test ---
/**
 * Lasso and erase hit tests for the ink worker (Rust `ink::hit_test`),
 * re-exported from index.ts.
 */
/** The `[minX, minY, maxX, maxY]` box of a flat `x,y` polygon (Rust `polygon_bounds`). */
export function inkPolygonBounds(polygon: Float64Array): Float64Array {
  return Float64Array.from(rawInkPolygonBounds(polygon));
}

// --- hybrid-fusion ---
/**
 * Hybrid fusion helpers (Rust `hybrid_fusion`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/search/hybrid-fusion.ts.
 */
/** Weight of the vector list in fusion; the keyword list is 1. */
export const HYBRID_VECTOR_WEIGHT = 1.5;
/** Fewest of the query's content terms a keyword hit must match to be fused. */
export const HYBRID_MIN_TERM_COVERAGE = 0.5;
/** Top vector hits kept even under the encoder's floor once the best hit clears it. */
export const HYBRID_VECTOR_KEEP_TOP = 5;

/** Keyword hits that matched enough of the query to be worth fusing. */
export function coveredHits<T extends { queryTerms?: readonly string[] }>(
  hits: readonly T[],
  termCount: number,
  minCoverage = HYBRID_MIN_TERM_COVERAGE,
): T[] {
  const mask = coveredHitMask(
    hits.map((hit) => hit.queryTerms?.length ?? null),
    termCount,
    minCoverage,
  );
  return hits.filter((_, position) => mask[position]);
}

/** Vector hits, best first, gated by the encoder's floor. */
export function gateVectorHits<T extends { score: number }>(
  hits: readonly T[],
  floor: number,
  keepTop = HYBRID_VECTOR_KEEP_TOP,
): T[] {
  const mask = gateVectorMask(hits.map((hit) => hit.score), floor, keepTop);
  return hits.filter((_, position) => mask[position]);
}

// --- outline ---
/**
 * The Outline section's headings (Rust `editor_workspace::outline`),
 * re-exported from index.ts.
 */
export type { OutlineHeading };
