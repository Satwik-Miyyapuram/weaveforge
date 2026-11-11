/**
 * Typed wrappers over the raw wasm exports, folded from 18 one-module files:
 * ink, ink-clipboard, ink-constants, ink-gesture, ink-lines, ink-page-math, ink-page-scissor,
 * ink-palette, ink-render-instances, ink-svg, integration-config, integration-hint, kind,
 * leaf-ports, log-entry, logbook-collapse-alert, mattermost-options, model-router.
 */
import {
  bandsCoincide as rawBandsCoincide,
  binomialSmooth as rawBinomialSmooth,
  collapseAlert as rawCollapseAlert,
  contactAreaMm2 as rawContactAreaMm2,
  createInkStrokePacker as rawCreateInkStrokePacker,
  createLogEntry as rawCreateLogEntry,
  doubleClickFigure as rawDoubleClickFigure,
  figureUnder as rawFigureUnder,
  formatReference as rawFormatReference,
  inkBandUnion as rawInkBandUnion,
  inkConstants as rawInkConstants,
  inkCurveAt as rawInkCurveAt,
  inkLineRecords as rawInkLineRecords,
  inkPageConfidence as rawInkPageConfidence,
  inkPageScissor as rawInkPageScissor,
  inkPageSvg as rawInkPageSvg,
  InkRoutePicker as RawInkRoutePicker,
  inkStrokeBandOf as rawInkStrokeBandOf,
  inkTangentAt as rawInkTangentAt,
  inkVocabularyWordList as rawInkVocabularyWordList,
  isUnsureConfidence as rawIsUnsureConfidence,
  logEntryInputError as rawLogEntryInputError,
  memberRank as rawMemberRank,
  mergeExtractions as rawMergeExtractions,
  nibWidth as rawNibWidth,
  packInkStroke as rawPackInkStroke,
  packInkStrokeInstances as rawPackInkStrokeInstances,
  paletteCss as rawPaletteCss,
  paletteHex as rawPaletteHex,
  paletteName as rawPaletteName,
  parseCssColour as rawParseCssColour,
  parseFigureClip as rawParseFigureClip,
  parseStrokeClip as rawParseStrokeClip,
  peersFromUsers as rawPeersFromUsers,
  samePalette as rawSamePalette,
  segmentInkLines as rawSegmentInkLines,
  selectModelProvider as rawSelectModelProvider,
  sharedProviderHint as rawSharedProviderHint,
  smoothInkStroke as rawSmoothInkStroke,
  spanPoints as rawSpanPoints,
  StrokeEdgeSplit as RawStrokeEdgeSplit,
  userGateOpen as rawUserGateOpen,
  withoutExisting as rawWithoutExisting,
} from "../pkg/wf_wasm.js";
import type {
  CollapsedAlert,
  DrawArea,
  ExtractionResult,
  FigureClip,
  HintDescriptor,
  HitBox as InkHitBox,
  InkSegmentationIndices,
  InkStroke,
  InkStrokePackerOptions,
  InkSvgOptions,
  InkSvgPage,
  IntegrationConfig,
  IntegrationEnv,
  LogEntry,
  LogKind,
  MattermostEvent,
  MattermostEventInfo,
  MattermostOptions,
  ModelProviderAvailability,
  NewLogEntryInput,
  PackedInkStroke,
  Peer,
  Point,
  Point as InkHitPoint,
  ProviderIds,
  ReferencePaper,
  RuntimeGate,
  SpanPoints,
  TextSpan,
} from "./bindings.js";

export {
  anchorAt,
  cappedEngineConfidence,
  clampInkNoteWidth,
  clampInkZoom,
  compactSkipReason,
  conceptKey,
  decodeInkWords,
  defaultModeFor,
  documentKind,
  documentSuffix,
  figureClipText,
  fitScale,
  gitlabCombinedActive,
  hasInkView,
  hasLazyBody,
  hasPdfView,
  inkBackingRatio,
  inkPageSummary,
  inkPressureFactor,
  inkStrokeBandOf,
  inkStrokeInstanceCount,
  inkUnsureConfidence,
  inkVelocityBetween,
  inkVelocityFactor,
  inkVocabularyHints,
  inkZoomIn,
  inkZoomOut,
  isCreatableKind,
  isDocumentKind,
  isUnsureConfidence,
  kindIcon,
  kindIconClass,
  kindNames,
  kindOwner,
  kindSuffix,
  kindTintClass,
  linkGroupOf,
  locateAnchor,
  logEntryInputError,
  mapInkConfidence,
  mattermostChannelFor,
  mattermostEvents,
  mattermostOptions,
  modesFor,
  openingTab,
  openModeFor,
  parseFolderDraft,
  pastedFigurePlace,
  pastedStrokesPlace,
  peersFromUsers,
  pressureByte,
  projectGateOpen,
  resampleInkStroke,
  resolveIntegrationConfig,
  samePeers,
  segmentsFor,
  selectedText,
  shouldPersistBody,
  snapInkShape,
  strokeBaseWidth,
  strokeClipText,
  strokePath,
  usesInkHighlighterPass,
} from "../pkg/wf_wasm.js";
export type {
  CollapsedAlert,
  FigureClip,
  HintDescriptor,
  HitBox as InkHitBox,
  InkSvgFigure,
  InkSvgOptions,
  InkSvgPage,
  InkSvgStroke,
  IntegrationConfig as ResolvedIntegrationConfig,
  IntegrationEnv,
  ModelProviderAvailability,
  Point as InkHitPoint,
  ProviderIds,
  RuntimeGate,
  TextLine as InkTextLine,
} from "./bindings.js";

// --- ink ---
/**
 * Ink geometry wrappers (step 5-2b), re-exported from index.ts. Point and
 * pressure arrays cross as `Float64Array`s; the stroke types come from
 * ./bindings.ts.
 */
/** The stroke's tangent at sample `i` for the span on `side` (Rust `ink_tangent_at`). */
export function inkTangentAt(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  i: number,
  side: "in" | "out" = "out",
): { x: number; y: number } {
  const [x, y] = rawInkTangentAt(Float64Array.from(xs), Float64Array.from(ys), i, side);
  return { x: x!, y: y! };
}

/** A point on the span from sample `i` to `i + 1` at `u` in [0, 1] (Rust `ink_curve_at`). */
export function inkCurveAt(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  i: number,
  u: number,
): { x: number; y: number } {
  const [x, y] = rawInkCurveAt(Float64Array.from(xs), Float64Array.from(ys), i, u);
  return { x: x!, y: y! };
}

/** `values` smoothed with the five-tap [1, 4, 6, 4, 1] / 16 kernel, ends kept (Rust `binomial_smooth`). */
export function binomialSmooth(values: readonly number[], stride: number, passes = 2): number[] {
  return Array.from(rawBinomialSmooth(Float64Array.from(values), stride, passes));
}

/** A finished stroke resampled and smoothed (Rust `smooth_ink_stroke`). */
export function smoothInkStroke(
  points: readonly number[],
  pressures: readonly number[],
  options: { spacing?: number; passes?: number } = {},
): PackedInkStroke {
  return rawSmoothInkStroke(Float64Array.from(points), Float64Array.from(pressures), options) as PackedInkStroke;
}

/** The nib width for a base width, pressure and speed (Rust `nib_width`). */
export function nibWidth(
  base: number,
  pressure?: number,
  velocity = 0,
  options: { fullTaper?: number } = {},
): number {
  return rawNibWidth(base, pressure, velocity, options.fullTaper);
}

/**
 * A live packer for one stroke (Rust `InkStrokePacker`): `push` each pen
 * sample, read `points()` / `pressures()` for the stroke so far.
 */
export function createInkStrokePacker(
  options: InkStrokePackerOptions = {},
): ReturnType<typeof rawCreateInkStrokePacker> {
  return rawCreateInkStrokePacker(options);
}

/** A whole stroke packed as the live packer would (Rust `pack_ink_stroke`). */
export function packInkStroke(
  points: readonly number[],
  pressures: readonly number[] = [],
  options: InkStrokePackerOptions = {},
): PackedInkStroke {
  return rawPackInkStroke(Float64Array.from(points), Float64Array.from(pressures), options) as PackedInkStroke;
}

/** The words a recogniser vocabulary allows, one per whitespace-separated token. */
export function inkVocabularyWords(vocabulary: readonly string[]): Set<string> {
  return new Set(rawInkVocabularyWordList([...vocabulary]) as string[]);
}

/** The y band [min, max] of a stroke, or null for a stroke with no points. */
export function inkStrokeBand(stroke: { points: ArrayLike<number> }): [number, number] | null {
  const band = rawInkStrokeBandOf(Float64Array.from(stroke.points));
  return band ? [band[0] as number, band[1] as number] : null;
}

/** The words a recogniser vocabulary allows, in order. */
export function inkVocabularyWordList(vocabulary: readonly string[]): string[] {
  return rawInkVocabularyWordList([...vocabulary]) as string[];
}

// --- ink-clipboard ---
/**
 * The copied figure and stroke clipboard, re-exported from index.ts. The types come
 * from bindings.ts; the functions are the Rust `ink_clipboard` exports. A parse that
 * finds nothing usable returns `null`.
 */
/** The figure a clipboard text names, or `null` (Rust `parse_figure_clip`). */
export function parseFigureClip(text: string | null | undefined): FigureClip | null {
  return rawParseFigureClip(text ?? undefined) as FigureClip | null;
}

/** The strokes a clipboard text carries, or `null` (Rust `parse_stroke_clip`). */
export function parseStrokeClip(text: string | null | undefined): InkStroke[] | null {
  return rawParseStrokeClip(text ?? undefined) as InkStroke[] | null;
}

// --- ink-constants ---
/**
 * The ink tuning constants (Rust `ink::{width, zoom, smooth, segment, decode, figure}`),
 * read by core through `rust()` at call time.
 */
/** The constants object `inkConstants()` returns; field names are camelCase. */
export interface InkConstants {
  inkWidthUnitsPerMm: number;
  inkPenWidths: [number, number, number, number];
  inkPenWidth: number;
  inkHighlighterWidth: number;
  inkHighlighterWidths: [number, number, number, number];
  inkHighlighterMinWidth: number;
  inkMinWidth: number;
  inkMaxWidth: number;
  inkVelocityFullTaper: number;
  inkVelocityTaper: number;
  inkPressureMinFactor: number;
  inkPressureMaxFactor: number;
  inkZoomMin: number;
  inkZoomMax: number;
  inkZoomStep: number;
  inkSmoothSpacing: number;
  inkSmoothPasses: number;
  inkGroupWindowMs: number;
  inkLineBandRatio: number;
  inkEngineMaxConfidence: number;
  figureAlt: string;
  figureHandles: [string, string, string, string, string, string, string, string];
}

/** The ink tuning constants, one call. */
export function inkConstants(): InkConstants {
  return rawInkConstants() as InkConstants;
}

// --- ink-gesture ---
/**
 * The ink pointer gesture (Rust `ink::gesture`): the route picker and the
 * stroke's cut at the paper's edge. The picker asks each question in turn; the
 * caller answers it and feeds the answer back, so a callback runs only when the
 * route needs it. The DOM and pointer events stay in
 * `apps/web/src/features/ink/application/parts-1.ts`.
 */
/** The armed tool, by name. */
export type InkToolName = "draw" | "eraser" | "lasso" | "region" | "none";

/** What a pointer's gesture does, or `null` when the caller keeps the down. */
export type InkRouteName = "erase" | "intercept" | "drag" | "lasso" | "draw" | "region";

/** A question the picker asks before it can choose. */
export type InkRouteQuestion = "sweepTip" | "admit" | "hitSelection" | "sweepTool" | "intercept";

/** The picker's next move: a question to answer, or the route. */
export type InkRouteStep =
  | { kind: "ask"; question: InkRouteQuestion }
  | { kind: "route"; route: InkRouteName | null };

/** What the caller knows about a down before any question. */
export interface InkRouteFacts {
  tool: InkToolName;
  tipErases: boolean;
  penBarrel: boolean;
  hasAdmit: boolean;
  hasHitSelection: boolean;
  hasIntercept: boolean;
}

/** One move of a stroke against the paper's edge. */
export type EdgeStepResult =
  | { kind: "inside" }
  | { kind: "outside" }
  | { kind: "exit"; at: Point }
  | { kind: "enter"; at: Point };

function parseStep(text: string): InkRouteStep {
  const separator = text.indexOf(":");
  const head = text.slice(0, separator);
  const name = text.slice(separator + 1);
  if (head === "ask") return { kind: "ask", question: name as InkRouteQuestion };
  return { kind: "route", route: name === "none" ? null : (name as InkRouteName) };
}

/** One down's route picker (Rust `RoutePicker`): built per down, driven to a route. */
export class InkRoutePicker {
  private readonly raw: RawInkRoutePicker;

  constructor(facts: InkRouteFacts) {
    this.raw = new RawInkRoutePicker(
      facts.tool,
      facts.tipErases,
      facts.penBarrel,
      facts.hasAdmit,
      facts.hasHitSelection,
      facts.hasIntercept,
    );
  }

  /** The first step: the back-tip sweep question. */
  start(): InkRouteStep {
    return parseStep(this.raw.start());
  }

  /** Feeds the answer to the last question and returns the next step. */
  answer(yes: boolean): InkRouteStep {
    return parseStep(this.raw.answer(yes));
  }
}

/** One stroke against the drawable area (Rust `StrokeEdgeSplit`). */
export class StrokeEdgeSplit {
  private readonly raw = new RawStrokeEdgeSplit();

  /** Whether the stroke is currently off the paper. */
  get outside(): boolean {
    return this.raw.outside;
  }

  begin(at: Point): void {
    this.raw.begin(at.x, at.y);
  }

  /** A `null` area means everywhere is paper. */
  move(at: Point, area: DrawArea | null): EdgeStepResult {
    return this.raw.move(at.x, at.y, area ?? null) as EdgeStepResult;
  }

  /** Forgets the stroke; true when it ended off the paper. */
  end(): boolean {
    return this.raw.end();
  }
}

// --- ink-lines ---
/**
 * Ink line segmentation and recognition helpers (steps 5-2c, 5-2d), re-exported from
 * index.ts. Rust returns stroke indices; these wrappers map them back to the
 * caller's stroke objects. serde_wasm_bindgen sends every f64 as a JS number,
 * so the `number | null` that bindings.ts gives an f64 is narrowed here.
 */
/**
 * A page's pen strokes grouped into lines, top to bottom, and the line each
 * input stroke went into (`-1` for none) (Rust `segment_ink_lines`).
 */
export function segmentInkLines<S extends { points: readonly number[]; tool: string; t0: number }>(
  strokes: readonly S[],
  options: { windowMs?: number; bandRatio?: number } = {},
): { lines: { strokes: S[]; yBand: [number, number] }[]; lineOfStroke: number[] } {
  const offsets = new Uint32Array(strokes.length + 1);
  strokes.forEach((stroke, i) => {
    offsets[i + 1] = offsets[i]! + stroke.points.length;
  });
  const points = Float64Array.from(strokes.flatMap((stroke) => stroke.points));
  const pen = Uint8Array.from(strokes, (stroke) => (stroke.tool === "pen" ? 1 : 0));
  const t0s = Float64Array.from(strokes, (stroke) => stroke.t0);
  const raw = rawSegmentInkLines(points, offsets, pen, t0s, options.windowMs, options.bandRatio) as InkSegmentationIndices;
  return {
    lines: raw.lines.map((line) => ({
      strokes: line.strokeIndices.map((index) => strokes[index]!),
      yBand: line.yBand as [number, number],
    })),
    lineOfStroke: raw.lineOfStroke,
  };
}

/**
 * Strokes reordered so each line's are contiguous, tagged with their line
 * (unsegmented ones last, `-1`), and the line records the container stores
 * (Rust `ink_line_records`).
 */
export function applyInkSegmentation<S extends object>(
  strokes: readonly S[],
  segmentation: { lines: readonly { strokes: readonly S[]; yBand: readonly [number, number] }[]; lineOfStroke: readonly number[] },
  recognised: readonly ({ text: string; confidence: number } | undefined)[] = [],
): {
  strokes: (S & { lineIndex: number })[];
  lines: { strokeStart: number; strokeCount: number; yMin: number; yMax: number; text: string; confidence: number }[];
} {
  const grouped: (S & { lineIndex: number })[] = [];
  segmentation.lines.forEach((line, lineIndex) => {
    for (const stroke of line.strokes) grouped.push({ ...stroke, lineIndex });
  });
  for (const [index, stroke] of strokes.entries()) {
    if (segmentation.lineOfStroke[index] === -1) grouped.push({ ...stroke, lineIndex: -1 });
  }
  const counts = Uint32Array.from(segmentation.lines, (line) => line.strokes.length);
  const bands = Float64Array.from(segmentation.lines.flatMap((line) => [line.yBand[0], line.yBand[1]]));
  return { strokes: grouped, lines: inkLineRecords(counts, bands, recognised) };
}

/**
 * The stored line records: `counts[i]` strokes in line `i`, `bands` its flat
 * `yMin, yMax` pairs, `recognised` its text and confidence (Rust `ink_line_records`).
 */
export function inkLineRecords(
  counts: Uint32Array,
  bands: Float64Array,
  recognised: readonly ({ text: string; confidence: number } | undefined)[] = [],
): { strokeStart: number; strokeCount: number; yMin: number; yMax: number; text: string; confidence: number }[] {
  return rawInkLineRecords(counts, bands, recognised) as ReturnType<typeof inkLineRecords>;
}

/** Whether a line's confidence is too low, or missing, to trust (Rust `is_unsure_confidence`). */
export function isUnsureLine(line: { conf: number }): boolean {
  return rawIsUnsureConfidence(line.conf);
}

/** Whether two y-bands overlap by at least half of the smaller one (Rust `bands_coincide`). */
export function bandsCoincide(a: readonly [number, number], b: readonly [number, number]): boolean {
  return rawBandsCoincide(a[0], a[1], b[0], b[1]);
}

/**
 * The `[start, end]` band spanning the flat `start, end` pairs given, or `null` when
 * there are none (Rust `band_union`).
 */
export function inkBandUnion(bands: Float64Array): [number, number] | null {
  const united = rawInkBandUnion(bands);
  return united.length === 2 ? [united[0]!, united[1]!] : null;
}

/** A page's mean line confidence, corrected lines counting as 1 (Rust `ink_page_confidence`). */
export function inkPageConfidence(lines: readonly { conf: number }[]): number {
  return rawInkPageConfidence(Float64Array.from(lines, (line) => line.conf));
}

// --- ink-page-math ---
/**
 * Ink page helpers: the fit, the selection's text and the figure hit tests
 * (Rust `ink::page_math`). Wasm returns `undefined` for "none"; these wrappers
 * return `null`, the shape the host has always used.
 */
/** The topmost figure whose box holds `at`, edges included, ignoring `skip`. */
export function figureUnder(
  figures: readonly (InkHitBox | undefined)[],
  at: InkHitPoint,
  skip: number | null = null,
): number | null {
  return rawFigureUnder(figures, at, skip ?? undefined) ?? null;
}

/** The figure every press of a double-click lands in, or `null`. */
export function doubleClickFigure(
  figures: readonly (InkHitBox | undefined)[],
  points: readonly InkHitPoint[],
  skip: number | null = null,
): number | null {
  return rawDoubleClickFigure(figures, points, skip ?? undefined) ?? null;
}

// --- ink-page-scissor ---
/**
 * WebGL page scissor box (Rust `ink::page_scissor`), re-exported from index.ts.
 */
/**
 * The page's `[x, y, width, height]` scissor box on a device-pixel surface. `view` is the
 * view's `scale` and `offsetX`/`offsetY` in CSS px; `page` and `surface` are sizes.
 */
export function inkPageScissor(
  view: { scale: number; offsetX: number; offsetY: number },
  dpr: number,
  page: { width: number; height: number },
  surface: { width: number; height: number },
): [number, number, number, number] {
  const box = rawInkPageScissor(
    view.scale,
    view.offsetX,
    view.offsetY,
    dpr,
    page.width,
    page.height,
    surface.width,
    surface.height,
  );
  return [box[0]!, box[1]!, box[2]!, box[3]!];
}

// --- ink-palette ---
/**
 * Ink palette colour maths and contact area (Rust `ink_palette`), re-exported from index.ts.
 * A palette crosses as its `[name, [r, g, b]]` pairs, in key order.
 */
/** A palette as the object the renderers read (name to `[r, g, b]`, each 0..1), as ordered pairs. */
function paletteEntries<K extends string>(
  palette: Readonly<Record<K, readonly [number, number, number]>>,
): [K, [number, number, number]][] {
  return (Object.keys(palette) as K[]).map((name) => [name, [...palette[name]]]);
}

/** One palette entry as a CSS colour: `rgb(...)` at alpha 1 or more, else `rgba(...)`. */
export function paletteCss<K extends string>(
  palette: Readonly<Record<K, readonly [number, number, number]>>,
  colour: string,
  alpha: number,
): string {
  return rawPaletteCss(paletteEntries(palette), colour, alpha);
}

/** One palette entry as `#rrggbb`. */
export function paletteHex<K extends string>(
  palette: Readonly<Record<K, readonly [number, number, number]>>,
  colour: string,
): string {
  return rawPaletteHex(paletteEntries(palette), colour);
}

/** The palette name a hex colour was written from, or `null`. */
export function paletteName<K extends string>(
  palette: Readonly<Record<K, readonly [number, number, number]>>,
  hex: string,
): K | null {
  return (rawPaletteName(paletteEntries(palette), hex) as K | undefined) ?? null;
}

/** Parse a computed CSS colour to `[r, g, b]` in 0..1, or `null` for one it does not read. */
export function parseCssColour(value: string): [number, number, number] | null {
  const rgb = rawParseCssColour(value);
  return rgb ? [rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0] : null;
}

/** Whether two palettes draw the same. */
export function samePalette<K extends string>(
  a: Readonly<Record<K, readonly [number, number, number]>>,
  b: Readonly<Record<K, readonly [number, number, number]>>,
): boolean {
  return rawSamePalette(paletteEntries(a), paletteEntries(b));
}

/** A touch's contact area in mm², from its CSS-pixel box. A missing side counts as 0. */
export function contactAreaMm2(event: { width?: number; height?: number }): number {
  return rawContactAreaMm2(event.width ?? 0, event.height ?? 0);
}

// --- ink-render-instances ---
/**
 * Ink render instance wrappers (WebGL stroke renderer maths). Point arrays
 * cross as `Float64Array`s. Rust: `wf_core::ink::render_instances`.
 */
/** The instance floats for a stroke from span `from` on (Rust `pack_stroke_instances`). */
export function packInkStrokeInstances(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  width: number,
  from = 0,
): Float64Array {
  return rawPackInkStrokeInstances(Float64Array.from(xs), Float64Array.from(ys), width, from);
}

// --- ink-svg ---
/**
 * Ink page SVG export wrappers, re-exported from index.ts. The types come from
 * bindings.ts; the functions are the Rust `ink_svg` exports.
 */
/** The page as an SVG document (Rust `ink_page_svg`). */
export function inkPageSvg(page: InkSvgPage, options: InkSvgOptions = {}): string {
  return rawInkPageSvg(page, options);
}

// --- integration-config ---
/**
 * Integration provider selection and runtime gates (Rust `integrations`),
 * re-exported from index.ts.
 */
/** Generated types; `ResolvedIntegrationConfig` is the Rust `IntegrationConfig`. */

/** Whether a user-scope descriptor shows. No gate means open. */
export function userGateOpen(
  config: Omit<IntegrationConfig, "gitRead"> & { gitRead: readonly string[] },
  gate: RuntimeGate | undefined,
): boolean {
  return rawUserGateOpen(config, gate ?? null) as boolean;
}

// --- integration-hint ---
/**
 * Shared-credentials hint under a project sync descriptor (Rust
 * `integrations::shared_provider_hint`), re-exported from index.ts.
 */
/** The hint for `descriptor` given all descriptors, or `undefined` when no sibling shares its provider. */
export function sharedProviderHint(
  descriptor: HintDescriptor,
  all: readonly HintDescriptor[],
): string | undefined {
  return (rawSharedProviderHint(descriptor, all) as string | null) ?? undefined;
}

// --- kind ---
/**
 * Per-kind table and lookups for the editor workspace (Rust `editor_workspace::kind`).
 * The table lives in Rust; these wrappers only type the results for the screen.
 */
/** Papers before notes inside a reading list. Unknown kinds sort last. */
export function memberRank(kind: string): number {
  // Rust's "no rank" is i32::MAX; callers have always seen Number.MAX_SAFE_INTEGER.
  const rank = rawMemberRank(kind);
  return rank === 2147483647 ? Number.MAX_SAFE_INTEGER : rank;
}

// --- leaf-ports ---
/**
 * Concept extraction, folder drafts (Rust `ai`), APA references (Rust `papers::reference_text`),
 * presence (Rust `collab`) and text anchors (Rust `text_anchor`), re-exported from index.ts.
 * Signatures match the removed TS in packages/core ai-assistant/domain/{ai-extraction,mcp-folder-draft}.ts
 * and apps/web {papers/domain/reference-text,collab/domain/presence}.ts.
 */
/** Merge results: counts summed, aliases unioned, mentions deduped; most-mentioned first. */
export function mergeExtractions<R extends ExtractionResult>(results: readonly R[]): R {
  return rawMergeExtractions(results) as R;
}

/** Drop concepts whose name or any alias is already in the wiki, and their mentions. */
export function withoutExisting<R extends ExtractionResult>(result: R, existing: readonly string[]): R {
  return rawWithoutExisting(result, [...existing]) as R;
}

/** A paper as an APA reference ready to paste. */
export function formatReference(paper: Omit<ReferencePaper, "authors"> & { authors: readonly string[] }): string {
  const { title, authors, year, venue, doi, arxivId, url } = paper;
  return rawFormatReference({ title, authors: [...authors], year, venue, doi, arxivId, url });
}

/** Awareness states → one entry per other person (not you, not your other sessions, one per person). */
export function peersFromStates(
  states: ReadonlyMap<number, unknown>,
  self: { clientId: number; authorId: string },
): Peer[] {
  const users = Array.from(states, ([id, s]): [number, unknown] => [id, (s as { user?: unknown } | null)?.user ?? null]);
  return rawPeersFromUsers(users, self.clientId, self.authorId);
}

/** Start and end `[line, column]` points of a text span over text nodes of `lengths` (Rust `span_points`), or null when the span is out of range. */
export function spanPoints(lengths: readonly number[], span: TextSpan): SpanPoints | null {
  return (rawSpanPoints([...lengths], span) as SpanPoints | null) ?? null;
}

// --- log-entry ---
/**
 * Log entry construction (Rust `log_entry`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/features/logbook/domain/parts.ts.
 */
export const LOG_KINDS: readonly LogKind[] = ["daily", "weekly"];

/**
 * Build a valid LogEntry from partial input, applying defaults and invariants.
 * The body is checked before the clock and id generator run, like the TS original.
 */
export function createLogEntry(
  input: NewLogEntryInput,
  deps: { clock: { nowIso(): string }; ids: { newId(): string } },
): LogEntry {
  const message = rawLogEntryInputError(input);
  if (message) {
    const error = new Error(message);
    error.name = "LogEntryValidationError";
    throw error;
  }
  const now = deps.clock.nowIso();
  return rawCreateLogEntry(input, deps.ids.newId(), now) as LogEntry;
}

// --- logbook-collapse-alert ---
/**
 * Citation-alert short form (Rust `logbook::collapse_alert`). Long citation alerts show their
 * first five papers, and the rest is hidden behind "Show n more".
 */
/** The short form of a citation alert, or null for any other entry or a short alert. */
export function collapseAlert(headline: string, rest: string): CollapsedAlert | null {
  return (rawCollapseAlert(headline, rest) as CollapsedAlert | undefined) ?? null;
}

// --- mattermost-options ---
/**
 * Mattermost notification events and routing (Rust `sync::mattermost_options`),
 * re-exported from index.ts.
 */
export type { MattermostEvent, MattermostEventInfo, MattermostOptions };

// --- model-router ---
/**
 * AI provider selection (Rust `ai::model_router::select_model_provider`), re-exported from index.ts.
 * A refusal throws its message as a string; callers wrap it in an Error.
 */
/** The provider `selected` names, which must be available. Throws the router's message when refused. */
export function selectModelProvider(providers: readonly ModelProviderAvailability[], selected: string): string {
  return rawSelectModelProvider(providers, selected);
}
