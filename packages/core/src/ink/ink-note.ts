/**
 * The ink *note*: its model, its frontmatter, its sidecar layout, and the one
 * place a stroke is packed for storage.
 *
 * An ink note is one markdown file whose body is the recognised text layer,
 * beside per-page binary chunks under `.ink/<weaveforge-id>/`. The model here is
 * the ergonomic half — names, not indices, and absolute coordinates in tenths of
 * a millimetre — while `ink-binary.ts` owns the container that writes those
 * indices and deltas to disk. The split is deliberate: a chunk written by an
 * older version still decodes into this model, and the model is what segmentation,
 * recognition, the renderer and `wf ink dump` all read.
 *
 * **Frontmatter is flat, and that is a deviation from §4.1's nested `ink:` map.**
 * The plan's sketch nests `pages`, `paper`, `pageOrder`, `recognised`, `engine`
 * and `hand` under one `ink:` key. `readFrontmatter` in `workspace/frontmatter.ts`
 * refuses nested maps *by design* — "a half-read map is worse than an absent key",
 * and modelling maps is deserialization surface the folder format deliberately
 * does not have — so a nested map would silently vanish on the way back in and
 * the note would lose its page order. Flat `ink-*` keys carry exactly the same
 * information, round-trip through the writer and reader that already exist, and
 * merge as text under the CRDT and under git, which is the property §4.1 was
 * actually asking for.
 */

import { simplifyPathIndices, INK_MAX_POINTS } from "../reader/ink-stroke.js";
import {
  frontmatterList,
  frontmatterString,
  type FrontmatterValue,
} from "../workspace/frontmatter.js";
import { clampInkNoteWidth, INK_PEN_WIDTH } from "./width.js";

/* -------------------------------------------------------------------------
 * Vocabulary
 * ---------------------------------------------------------------------- */

/** Tools a stroke can be drawn with. `shape` is a snapped or rough figure. */
export const INK_TOOLS = ["pen", "highlighter", "shape"] as const;
export type InkTool = (typeof INK_TOOLS)[number];

/**
 * The palette a stroke's colour indexes into.
 *
 * Names, never hex: the design's palette rule is that no colour is written in
 * code, and a chunk that stored `#b45309` would survive a theme change as the
 * wrong colour. The binary container writes the index.
 */
export const INK_COLOURS = ["text", "accent", "warn", "good", "info", "danger"] as const;
export type InkColour = (typeof INK_COLOURS)[number];

/**
 * Page backgrounds. Painted from CSS tokens; nothing about them is stored.
 * The order is the binary enum (`ink-binary` byte 20), so new papers go on
 * the end: an older reader that meets an index past its own list falls back
 * to blank rather than misreading the page.
 */
export const INK_PAPERS = ["blank", "dotted", "ruled", "grid", "wide"] as const;
export type InkPaper = (typeof INK_PAPERS)[number];

/** An optional snapped shape replacing a stroke's freehand path. */
export const INK_SHAPES = ["none", "line", "rect", "ellipse", "arrow"] as const;
export type InkShape = (typeof INK_SHAPES)[number];

/** Which hand the writer uses. Only the palm-rejection quadrant rule reads it. */
export const INK_HANDS = ["right", "left"] as const;
export type InkHand = (typeof INK_HANDS)[number];

/** Index of a name in one of the vocabularies above, or 0 where unknown. */
export function inkEnumIndex<T extends string>(values: readonly T[], value: string): number {
  const index = values.indexOf(value as T);
  return index < 0 ? 0 : index;
}

/** The name at an index, or the vocabulary's first entry where out of range. */
export function inkEnumValue<T extends string>(values: readonly T[], index: number): T {
  return values[index] ?? values[0]!;
}

/* -------------------------------------------------------------------------
 * Geometry
 * ---------------------------------------------------------------------- */

/** A4 at 10 units per mm: the default page, in 0.1 mm. */
export const INK_A4_WIDTH = 2100;
export const INK_A4_HEIGHT = 2970;

/** Coordinates are `Int16` in the container, so no page may exceed this. */
export const INK_COORD_LIMIT = 32767;

/** Points per stroke, unchanged from the reader's cap (§4.7). */
export const INK_STROKE_MAX_POINTS = INK_MAX_POINTS;

/** Strokes per page: soft. Past it the ink bar warns and keeps drawing (§4.7). */
export const INK_PAGE_STROKE_BUDGET = 5_000;

/** Pages per note, unchanged (§4.7). */
export const INK_NOTE_MAX_PAGES = 50;

/** Rounding tolerance for a packed stroke, in 0.1 mm (0.12 mm). */
export const INK_PACK_TOLERANCE = 1.2;

/**
 * Pressure deviation, out of 255, that keeps a point RDP would have dropped.
 *
 * The first simplification pass is pressure-blind: it keeps a point only when
 * the centreline bends. A point carrying a heavy press or a lift inside a
 * straight run would then vanish and the taper with it — the stroke would still
 * be in the right place and would no longer look written. This is the threshold
 * that second, pressure-aware pass uses (§4.4).
 */
export const INK_PACK_PRESSURE_TOLERANCE = 20;

/** One stroke as the model holds it: absolute points, names, no deltas. */
export interface InkStroke {
  /** Absolute positions in 0.1 mm as `[x0, y0, x1, y1, …]`. Always even. */
  points: readonly number[];
  /** Pressure per point, 0–255, or `[]` when the device reports none. */
  pressures: readonly number[];
  /** Base nib width in 0.1 mm, before per-point pressure and velocity. */
  width: number;
  tool: InkTool;
  colour: InkColour;
  /** Stroke start, ms from page creation. Segmentation needs gaps, not times. */
  t0: number;
  shape: InkShape;
  /** Line this stroke was segmented into, `-1` when it never was. */
  lineIndex: number;
}

/** A stroke's fields with the defaults filled in. */
export function makeInkStroke(input: Partial<InkStroke> & { points: readonly number[] }): InkStroke {
  return {
    points: input.points,
    pressures: input.pressures ?? [],
    width: clampInkNoteWidth(input.width ?? INK_PEN_WIDTH),
    tool: input.tool ?? "pen",
    colour: input.colour ?? "text",
    t0: input.t0 ?? 0,
    shape: input.shape ?? "none",
    lineIndex: input.lineIndex ?? -1,
  };
}

/**
 * One recognised line of a page.
 *
 * `strokeStart`/`strokeCount` are indices into the page's stroke list rather
 * than stroke objects, because that is what the container stores and because a
 * lasso's "copy as text" needs to map a line back to the strokes that drew it.
 */
export interface InkLineRecord {
  strokeStart: number;
  strokeCount: number;
  yMin: number;
  yMax: number;
  /** The *recognised* text. The note body holds the *accepted* text (§4.2). */
  text: string;
  /** Engine score mapped to `[0, 1]`; `1` once a human corrected the line. */
  confidence: number;
}

/** A page as the model holds it: absolute geometry plus its recognised lines. */
export interface InkPage {
  width: number;
  height: number;
  paper: InkPaper;
  /** Index into the note's attachments for a page image; `0` is none. */
  background: number;
  strokes: readonly InkStroke[];
  lines: readonly InkLineRecord[];
}

/** An empty A4 page, which is what a note with no sidecar is made of. */
export function blankInkPage(paper: InkPaper = "blank"): InkPage {
  return {
    width: INK_A4_WIDTH,
    height: INK_A4_HEIGHT,
    paper,
    background: 0,
    strokes: [],
    lines: [],
  };
}

/** Width and height of a page, clamped to what an `Int16` coordinate can hold. */
export function clampInkPageSize(width: number, height: number): { width: number; height: number } {
  const fit = (value: number, fallback: number) =>
    Number.isFinite(value) && value > 0 ? Math.min(INK_COORD_LIMIT, Math.round(value)) : fallback;
  return { width: fit(width, INK_A4_WIDTH), height: fit(height, INK_A4_HEIGHT) };
}

/* -------------------------------------------------------------------------
 * Packing a stroke for storage
 * ---------------------------------------------------------------------- */

export interface PackedInkStroke {
  points: number[];
  pressures: number[];
}

/**
 * Storage-ready form of one captured stroke, pressure included.
 *
 * Three passes, in the order §4.4 gives them: capture filtering has already
 * happened by the time a stroke reaches here, so this is the save budget
 * (Ramer–Douglas–Peucker, then a hard cap of {@link INK_STROKE_MAX_POINTS}), then
 * the pressure-aware pass that puts back a point whose pressure the centreline
 * simplification threw away. Coordinates are rounded to whole 0.1 mm units,
 * which is what the container stores.
 */
export function packInkStroke(
  points: readonly number[],
  pressures: readonly number[] = [],
  options: {
    tolerance?: number;
    maxPoints?: number;
    pressureTolerance?: number;
  } = {},
): PackedInkStroke {
  const tolerance = options.tolerance ?? INK_PACK_TOLERANCE;
  const maxPoints = options.maxPoints ?? INK_STROKE_MAX_POINTS;
  const pressureTolerance = options.pressureTolerance ?? INK_PACK_PRESSURE_TOLERANCE;

  const even = points.slice(0, Math.floor(points.length / 2) * 2);
  if (even.length < 4 || even.some((value) => !Number.isFinite(value))) {
    return { points: [], pressures: [] };
  }
  const rounded = even.map((value) =>
    Math.max(-INK_COORD_LIMIT, Math.min(INK_COORD_LIMIT, Math.round(value))),
  );
  const usablePressures = pressures.length === rounded.length / 2 ? pressures : [];

  let keep = simplifyPathIndices(rounded, tolerance);
  // Doubling the tolerance roughly halves the survivors, so this ends after a
  // handful of rounds even for a pathological scribble.
  let guard = 0;
  while (keep.length > maxPoints && guard < 12) {
    keep = simplifyPathIndices(rounded, tolerance * 2 ** (guard + 1));
    guard += 1;
  }
  if (keep.length > maxPoints) {
    // Still over budget: an evenly spaced subset keeps the stroke's full extent
    // rather than losing its end, and the true end point is forced back in.
    const step = keep.length / maxPoints;
    const sampled: number[] = [];
    for (let i = 0; i < maxPoints; i += 1) sampled.push(keep[Math.min(keep.length - 1, Math.floor(i * step))]!);
    sampled[sampled.length - 1] = keep[keep.length - 1]!;
    keep = [...new Set(sampled)].sort((a, b) => a - b);
  }

  // Two surviving points are still a segment with an interior, and the interior
  // is exactly where a straight stroke's taper lives — a hand-drawn line that
  // presses in the middle keeps that press only if this pass runs.
  if (usablePressures.length > 0 && keep.length >= 2) {
    keep = restorePressureSignificant(keep, usablePressures, pressureTolerance);
  }

  const outPoints: number[] = [];
  const outPressures: number[] = [];
  for (const index of keep) {
    outPoints.push(rounded[index * 2]!, rounded[index * 2 + 1]!);
    outPressures.push(pressureByte(usablePressures[index]));
  }
  return { points: outPoints, pressures: outPressures };
}

/**
 * Put back the points whose pressure the centreline pass removed.
 *
 * A point is restored when its pressure departs from the straight line between
 * its surviving neighbours by more than `tolerance`, in the 0–255 pressure
 * range. Restoring a point splits its segment, so the neighbours of the *next*
 * candidate change; that is why this repeats until nothing more is restored,
 * with a hard round cap so a pathological ramp cannot loop.
 */
function restorePressureSignificant(
  keep: readonly number[],
  pressures: readonly number[],
  tolerance: number,
): number[] {
  const kept = [...keep];
  for (let round = 0; round < 8; round += 1) {
    const restored: number[] = [];
    for (let i = 0; i + 1 < kept.length; i += 1) {
      const from = kept[i]!;
      const to = kept[i + 1]!;
      if (to <= from + 1) continue;
      const fromPressure = pressures[from] ?? 0;
      const toPressure = pressures[to] ?? 0;
      for (let index = from + 1; index < to; index += 1) {
        const t = (index - from) / (to - from);
        const expected = fromPressure + (toPressure - fromPressure) * t;
        if (Math.abs((pressures[index] ?? 0) - expected) > tolerance) restored.push(index);
      }
    }
    if (restored.length === 0) break;
    kept.push(...restored);
    kept.sort((a, b) => a - b);
  }
  return kept;
}

/** Pressure clamped and rounded into the container's `Uint8` slot. */
export function pressureByte(pressure: number | undefined): number {
  if (typeof pressure !== "number" || !Number.isFinite(pressure)) return 0;
  return Math.max(0, Math.min(255, Math.round(pressure)));
}

/* -------------------------------------------------------------------------
 * Frontmatter
 * ---------------------------------------------------------------------- */

/** The `weaveforge-type` an ink note carries. */
export const INK_NOTE_TYPE = "ink_page";

/**
 * The ink keys this format writes, by their role rather than their spelling.
 *
 * Flat and prefixed, so a mirror round-trip through `readFrontmatter` keeps
 * them; see this module's header for why the plan's nested map cannot.
 */
export const INK_KEYS = {
  pages: "ink-pages",
  paper: "ink-paper",
  pageOrder: "ink-page-order",
  recognised: "ink-recognised",
  engine: "ink-engine",
  hand: "ink-hand",
} as const;

export interface InkNoteMeta {
  /** Page count as declared; the sidecar directory is what actually holds them. */
  pages: number;
  paper: InkPaper;
  /** Chunk ids, in reading order. Order is metadata; identity is the filename. */
  pageOrder: readonly string[];
  /** Mean recognition confidence, `0` when the note has never been recognised. */
  recognised: number;
  /** The engine that produced the text layer, or `null` for none yet. */
  engine: string | null;
  hand: InkHand;
}

/** The metadata a note with no `ink-*` keys at all gets: one blank page. */
export function defaultInkNoteMeta(): InkNoteMeta {
  return { pages: 1, paper: "blank", pageOrder: [], recognised: 0, engine: null, hand: "right" };
}

/** Whether a frontmatter block is an ink note's, by the type it declares. */
export function isInkNoteFrontmatter(frontmatter: Record<string, FrontmatterValue>): boolean {
  return frontmatterString(frontmatter, "weaveforge-type") === INK_NOTE_TYPE;
}

/**
 * Read the ink metadata out of a note's frontmatter.
 *
 * A note with no sidecar and no `ink-*` keys is a valid empty ink note, so
 * everything here is optional and the defaults are the honest ones: one blank
 * page, no engine, no recognition.
 */
export function readInkNoteMeta(frontmatter: Record<string, FrontmatterValue>): InkNoteMeta {
  const fallback = defaultInkNoteMeta();
  const pages = Number(frontmatterString(frontmatter, INK_KEYS.pages) ?? "");
  const recognised = Number(frontmatterString(frontmatter, INK_KEYS.recognised) ?? "");
  const paper = frontmatterString(frontmatter, INK_KEYS.paper);
  const hand = frontmatterString(frontmatter, INK_KEYS.hand);
  return {
    pages:
      Number.isFinite(pages) && pages > 0
        ? Math.min(INK_NOTE_MAX_PAGES, Math.floor(pages))
        : fallback.pages,
    paper: (INK_PAPERS as readonly string[]).includes(paper ?? "")
      ? (paper as InkPaper)
      : fallback.paper,
    pageOrder: frontmatterList(frontmatter, INK_KEYS.pageOrder).filter(isInkChunkId),
    recognised:
      Number.isFinite(recognised) && recognised >= 0 && recognised <= 1
        ? recognised
        : fallback.recognised,
    engine: frontmatterString(frontmatter, INK_KEYS.engine) ?? null,
    hand: (INK_HANDS as readonly string[]).includes(hand ?? "") ? (hand as InkHand) : fallback.hand,
  };
}

/** The frontmatter a note's ink metadata is written as. */
export function writeInkNoteMeta(
  meta: InkNoteMeta,
): Record<string, FrontmatterValue | undefined> {
  return {
    [INK_KEYS.pages]: meta.pages,
    [INK_KEYS.paper]: meta.paper,
    [INK_KEYS.pageOrder]: meta.pageOrder.length > 0 ? [...meta.pageOrder] : undefined,
    [INK_KEYS.recognised]: Number(meta.recognised.toFixed(2)),
    [INK_KEYS.engine]: meta.engine ?? undefined,
    [INK_KEYS.hand]: meta.hand,
  };
}

/* -------------------------------------------------------------------------
 * The ink header inside a stored body
 * ---------------------------------------------------------------------- */

/**
 * The first line of an ink note's stored body.
 *
 * The database keeps a note as `title + body` and nothing else — no type column,
 * no frontmatter — so the ink metadata (§4.2's `ink:` block) has to travel inside
 * the body when the note is a row rather than a file. It travels as one HTML
 * comment on the first line, which markdown renders as nothing, the mirror
 * lifts into frontmatter on the way out (`serialize-workspace.ts`) and puts back
 * on the way in. Everything after it is the text layer.
 */
export const INK_BODY_HEADER = "<!-- weaveforge-ink";

const INK_BODY_HEADER_LINE = /^<!--\s*weaveforge-ink\b([^]*?)-->[ \t]*\r?\n?/;

/** Whether a stored body is an ink note's. Cheap: it looks at the first line only. */
export function isInkNoteBody(body: string | null | undefined): boolean {
  return typeof body === "string" && body.startsWith(INK_BODY_HEADER);
}

/**
 * Split a stored body into its ink metadata and its text layer.
 *
 * A body with no header is a plain note read as an empty ink note — which is what
 * a note that has never been opened with a pen is.
 */
export function readInkNoteBody(body: string): { meta: InkNoteMeta; text: string } {
  const match = INK_BODY_HEADER_LINE.exec(body);
  if (!match) return { meta: defaultInkNoteMeta(), text: body };
  const record: Record<string, FrontmatterValue> = {};
  for (const token of match[1]!.trim().split(/\s+/)) {
    const eq = token.indexOf("=");
    if (eq <= 0) continue;
    const key = token.slice(0, eq);
    const value = token.slice(eq + 1);
    record[key] = key === INK_KEYS.pageOrder ? value.split(",").filter(Boolean) : value;
  }
  return { meta: readInkNoteMeta(record), text: stripStrayHeaders(body.slice(match[0].length)) };
}

/**
 * A header line that is not the first line is not metadata, it is damage: an
 * earlier build once wrote the header over a body that already had one, and a
 * cut-off copy (no `-->`) can be left at the top of the text layer, where the
 * reader would show it as page 1's text. Only the header line is metadata;
 * whatever else leads the text is dropped here so the next save heals the note.
 */
const STRAY_HEADER_LINE = /^<!--\s*weaveforge-ink\b[^\n]*(?:\r?\n|$)/;

function stripStrayHeaders(text: string): string {
  let out = text;
  for (;;) {
    const next = out.replace(STRAY_HEADER_LINE, "");
    if (next === out) return out;
    out = next;
  }
}

/** Join ink metadata and a text layer back into the body the database keeps. */
export function writeInkNoteBody(meta: InkNoteMeta, text: string): string {
  const fields = writeInkNoteMeta(meta);
  const tokens: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    tokens.push(`${key}=${Array.isArray(value) ? value.join(",") : String(value)}`);
  }
  return `${INK_BODY_HEADER} ${tokens.join(" ")} -->\n${text.replace(/^\r?\n/, "")}`;
}

/* -------------------------------------------------------------------------
 * The text layer in the body
 * ---------------------------------------------------------------------- */

const PAGE_MARKER = /^<!--\s*page\s+\d+\s*-->$/;

/** The marker that separates page *n* from page *n−1*, 2-based by definition. */
export function inkPageMarker(page: number): string {
  return `<!-- page ${page} -->`;
}

/**
 * Split a note body into one text layer per page.
 *
 * Page 1 opens the body and carries no marker; every later page is introduced by
 * `<!-- page N -->`, which is what §4.1 draws. A body with no marker is one page,
 * and a body with no text at all is one empty page — an ink note whose strokes
 * have never been recognised is still a valid note. Any marker is a page break,
 * whatever number it carries: the number is for a human reading the file, and the
 * order is the order the markers appear in.
 */
export function splitInkTextLayer(body: string): string[] {
  const pages: string[][] = [[]];
  for (const line of body.split(/\r?\n/)) {
    if (PAGE_MARKER.test(line.trim())) {
      pages.push([]);
      continue;
    }
    pages[pages.length - 1]!.push(line);
  }
  return pages.map((lines) => trimBlankEdges(lines).join("\n"));
}

/**
 * One text layer back into a note body, markers and all.
 *
 * The inverse of {@link splitInkTextLayer} for a body this module wrote: the
 * markers are numbered from the array's own order, so split → join → split is
 * identity and a re-save cannot renumber a page by accident.
 */
export function joinInkTextLayer(pages: readonly string[]): string {
  if (pages.length === 0) return "";
  return `${pages
    .map((text, index) => {
      const trimmed = text.trim();
      if (index === 0) return trimmed;
      return [`<!-- page ${index + 1} -->`, trimmed].filter(Boolean).join("\n\n");
    })
    .join("\n\n")}\n`;
}

/* -------------------------------------------------------------------------
 * A page's background: an attachment (§4.8)
 * ---------------------------------------------------------------------- */

/** The alt text that marks an image ref as a page's background rather than a figure. */
export const INK_BACKGROUND_ALT = "page background";

const BACKGROUND_LINE = /^!\[page background\]\(vault:([^)\s]+)\)$/;

/**
 * The attachment a page's text layer names as its background, or `null`.
 *
 * An inserted PDF page is a raster in the vault's attachment folder and an
 * `![page background](vault:…)` on the first line of that page's text layer
 * (§4.8) — in the body so the vault's own image bookkeeping sees it, on the
 * page so it moves with the page. The sidecar's `bg` index is a mirror of the
 * same fact for a reader that has only the chunk; this line is what the host
 * reads.
 */
export function inkPageBackground(text: string): string | null {
  const first = text.split(/\r?\n/, 1)[0]?.trim() ?? "";
  const match = BACKGROUND_LINE.exec(first);
  return match ? match[1]! : null;
}

/**
 * A page's text layer with its background line set, replaced or removed.
 *
 * Recognition replaces the page's text wholesale, so the host re-applies the
 * page's background through this after every run; the line always sits first
 * and there is never more than one.
 */
export function withInkPageBackground(text: string, path: string | null): string {
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && BACKGROUND_LINE.test(lines[0]!.trim())) lines.shift();
  const rest = trimBlankEdges(lines).join("\n");
  if (!path) return rest;
  const line = `![${INK_BACKGROUND_ALT}](vault:${path})`;
  return rest ? `${line}\n\n${rest}` : line;
}

/**
 * The 1-based attachment index a page's chunk header carries for `path`, or
 * `0`: the position of the path among every `vault:` image ref in the body,
 * in order of first appearance, which is what "index into attachments" means
 * in the chunk format (§4.3).
 */
export function inkAttachmentIndex(body: string, path: string | null): number {
  if (!path) return 0;
  const seen: string[] = [];
  const re = /!\[[^\]]*\]\(vault:([^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    if (!seen.includes(match[1]!)) seen.push(match[1]!);
  }
  const index = seen.indexOf(path);
  return index < 0 ? 0 : Math.min(255, index + 1);
}

function trimBlankEdges(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start]!.trim()) start += 1;
  while (end > start && !lines[end - 1]!.trim()) end -= 1;
  return lines.slice(start, end);
}

/* -------------------------------------------------------------------------
 * The sidecar on disk
 * ---------------------------------------------------------------------- */

/** Top-level sidecar directory, beside the mirrored folders. */
export const INK_SIDECAR_DIR = ".ink";

/** Chunk file extension: one page, columnar binary, compressed. */
export const INK_CHUNK_EXT = ".inkb";

/** Ids are woven through a path, so anything path-shaped is refused. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isInkNoteId(id: string): boolean {
  return SAFE_ID.test(id);
}

/** A ULID: 26 Crockford base32 characters, the chunk filename. */
const CHUNK_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isInkChunkId(id: string): boolean {
  return CHUNK_ID.test(id);
}

/** `.ink/<weaveforge-id>` — keyed by id, so a rename never orphans strokes. */
export function inkSidecarDir(noteId: string): string {
  if (!isInkNoteId(noteId)) throw new Error(`ink: unusable note id ${JSON.stringify(noteId)}`);
  return `${INK_SIDECAR_DIR}/${noteId}`;
}

/** `.ink/<weaveforge-id>/<ulid>.inkb` — one page of one note. */
export function inkChunkPath(noteId: string, chunkId: string): string {
  if (!isInkChunkId(chunkId)) throw new Error(`ink: unusable chunk id ${JSON.stringify(chunkId)}`);
  return `${inkSidecarDir(noteId)}/${chunkId}${INK_CHUNK_EXT}`;
}

/** The note and chunk a sidecar path names, or `null` for anything else. */
export function parseInkChunkPath(path: string): { noteId: string; chunkId: string } | null {
  const match = /^\.ink\/([^/]+)\/([^/]+)\.inkb$/.exec(path.replace(/^\/+/, ""));
  if (!match) return null;
  const [, noteId, chunkId] = match;
  if (!isInkNoteId(noteId!) || !isInkChunkId(chunkId!)) return null;
  return { noteId: noteId!, chunkId: chunkId! };
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Random bytes from the platform, or `Math.random` where there is no Web Crypto. */
function defaultRandomBytes(target: Uint8Array): void {
  const webCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (webCrypto?.getRandomValues) {
    webCrypto.getRandomValues(target);
    return;
  }
  for (let i = 0; i < target.length; i += 1) target[i] = Math.floor(Math.random() * 256);
}

/**
 * A fresh chunk id: a ULID, sortable by creation and collision-free in practice.
 *
 * Filenames are ULIDs rather than page numbers because order is metadata and
 * identity is the filename — reordering a page must not rename every file, which
 * would churn sync and break the note's own `pageOrder` (§4.1).
 */
export function newInkChunkId(
  options: { now?: number; randomBytes?: (target: Uint8Array) => void } = {},
): string {
  const now = options.now ?? Date.now();
  const fill = options.randomBytes ?? defaultRandomBytes;
  const bytes = new Uint8Array(10);
  fill(bytes);

  let time = "";
  let remaining = Math.max(0, Math.floor(now));
  for (let i = 0; i < 10; i += 1) {
    time = CROCKFORD[remaining % 32]! + time;
    remaining = Math.floor(remaining / 32);
  }

  // Eighty random bits, five per character. Each character takes the five bits
  // starting at its own offset in the byte stream, most significant bit first.
  let random = "";
  for (let i = 0; i < 16; i += 1) {
    const start = i * 5;
    const window = ((bytes[start >> 3] ?? 0) << 8) | (bytes[(start >> 3) + 1] ?? 0);
    random += CROCKFORD[(window >> (11 - (start & 7))) & 31]!;
  }
  return time + random;
}

/**
 * The page order a note's frontmatter declares, reconciled with the chunks that
 * actually exist.
 *
 * A chunk file that vanished must not make a note unopenable, and a chunk that
 * appeared without being recorded (a sync race, a hand copy) must not be hidden.
 * Declared order first, then anything left over in id order — ids are ULIDs, so
 * that is creation order.
 */
export function resolveInkPageOrder(
  declared: readonly string[],
  present: readonly string[],
): string[] {
  const available = new Set(present.filter(isInkChunkId));
  const ordered = declared.filter((id) => available.has(id));
  const seen = new Set(ordered);
  const extra = present.filter((id) => !seen.has(id) && isInkChunkId(id)).sort();
  return [...ordered, ...extra].slice(0, INK_NOTE_MAX_PAGES);
}

/** Whether a page's stroke count is over the soft budget it should warn about. */
export function inkPageOverBudget(page: InkPage): boolean {
  return page.strokes.length > INK_PAGE_STROKE_BUDGET;
}
