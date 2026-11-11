import { rust } from "../shared/rust.js";

// --- ink-note ---
/** Types for ink-note. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
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
 * wrong colour. The binary container writes the index, so new colours go on
 * the end: an older reader that meets an index past its own list falls back
 * to the first entry rather than misreading the stroke.
 *
 * The first six are the theme's own tokens. The eight after them are the
 * marker colours the PDF reader's pen offers (`READER_ANNOTATION_COLORS`),
 * named here so a note and a paper draw from one palette.
 */
export const INK_THEME_COLOURS = ["text", "accent", "warn", "good", "info", "danger"] as const;

export const INK_MARKER_COLOURS = [
  "yellow",
  "red",
  "green",
  "blue",
  "purple",
  "pink",
  "orange",
  "grey",
] as const;

export const INK_COLOURS = ["text", "accent", "warn", "good", "info", "danger", "yellow", "red", "green", "blue", "purple", "pink", "orange", "grey"] as const;

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

/* -------------------------------------------------------------------------
 * Geometry
 * ---------------------------------------------------------------------- */

/** A4 at 10 units per mm: the default page, in 0.1 mm. */
export const INK_A4_WIDTH = 2100;

export const INK_A4_HEIGHT = 2970;

/** Coordinates are `Int16` in the container, so no page may exceed this. */
export const INK_COORD_LIMIT = 32767;

/** Points per stroke: the container stores a stroke's length as a `Uint16`. */
export const INK_STROKE_MAX_POINTS = 65_535;

/** Strokes per page: soft. Past it the ink bar warns and keeps drawing (§4.7). */
export const INK_PAGE_STROKE_BUDGET = 5_000;

/** Pages per note, unchanged (§4.7). */
export const INK_NOTE_MAX_PAGES = 50;

/** Rounding tolerance for a packed stroke, in 0.1 mm (0.12 mm). */
export const INK_PACK_TOLERANCE = 1.2;

/**
 * Pressure deviation, out of 255, that keeps a point the centreline does not need.
 *
 * A point carrying a heavy press or a lift inside a straight run would
 * otherwise vanish and the taper with it — the stroke would still be in the
 * right place and would no longer look written (§4.4).
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

/* -------------------------------------------------------------------------
 * Packing a stroke for storage
 * ---------------------------------------------------------------------- */

export interface PackedInkStroke {
  points: number[];
  pressures: number[];
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
 * lifts into frontmatter on the way out (the Rust serializer) and puts back
 * on the way in. Everything after it is the text layer.
 */
export const INK_BODY_HEADER = "<!-- weaveforge-ink";

const INK_BODY_HEADER_LINE = /^<!--\s*weaveforge-ink\b([^]*?)-->[ \t]*\r?\n?/;

/**
 * A header line that is not the first line is not metadata, it is damage: an
 * earlier build once wrote the header over a body that already had one, and a
 * cut-off copy (no `-->`) can be left at the top of the text layer, where the
 * reader would show it as page 1's text. Only the header line is metadata;
 * whatever else leads the text is dropped here so the next save heals the note.
 */
const STRAY_HEADER_LINE = /^<!--\s*weaveforge-ink\b[^\n]*(?:\r?\n|$)/;

/* -------------------------------------------------------------------------
 * The text layer in the body
 * ---------------------------------------------------------------------- */

const PAGE_MARKER = /^<!--\s*page\s+\d+\s*-->$/;

/* -------------------------------------------------------------------------
 * A page's background: an attachment (§4.8)
 * ---------------------------------------------------------------------- */

/** The alt text that marks an image ref as a page's background rather than a figure. */
export const INK_BACKGROUND_ALT = "page background";

const BACKGROUND_LINE = /^!\[page background\]\(vault:([^)\s]+)\)$/;

/* -------------------------------------------------------------------------
 * The sidecar on disk
 * ---------------------------------------------------------------------- */

/** Top-level sidecar directory, beside the mirrored folders. */
export const INK_SIDECAR_DIR = ".ink";

/** Chunk file extension: one page, columnar binary, compressed. */
export const INK_CHUNK_EXT = ".inkb";

/** Ids are woven through a path, so anything path-shaped is refused. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** A ULID: 26 Crockford base32 characters, the chunk filename. */
const CHUNK_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// --- recognise ---
/**
 * Recognition: the contract every handwriting engine implements, and the order
 * they are preferred in (§5.1–§5.2).
 *
 * This module is **pure types and policy** — it imports no engine, names no
 * platform and does no I/O. The engines live behind {@link InkRecogniser} in the
 * layers that can reach them: Windows Ink through the desktop helper, an online
 * stroke model in the web worker, Chromium's own API when a build has it. That
 * keeps "which engine" a runtime decision and lets an ink note with *no* engine
 * stay a valid note: a title, typed links and strokes.
 *
 * The distinction that is load-bearing is `online`. An online engine consumes
 * the trajectory — direction, order, speed, pen-up gaps, pressure — which is
 * exactly what the digitiser already reports. An image engine re-infers all of
 * that from a raster, which is why it needs hundreds of megabytes and seconds
 * per page. Engines that are online are preferred, and the retracted v1 plan's
 * image OCR is not in the order at all.
 */
/** A line of strokes, as segmentation hands it to an engine. */
export interface InkLine {
  strokes: InkStroke[];
  yBand: [number, number];
}

/** What an engine returned for one line. */
export interface RecognisedLine {
  text: string;
  /** Engine score mapped to `[0, 1]`; `1` marks a human-corrected line. */
  conf: number;
  /** Other readings the engine offered, best first, for the correction UI. */
  alternatives?: string[];
}

/** What an engine is given besides the strokes. */
export interface InkRecognitionHints {
  /**
   * Words the note is likely to contain — note titles, paper titles, citation
   * keys. Windows Ink takes a word list as a recognition guide, which an image
   * model cannot; where an engine ignores it, `vocab-match.ts` is the post-pass.
   */
  vocabulary: string[];
  /** BCP 47 tag. Engines are told the language rather than guessing. */
  lang: string;
}

export interface InkRecogniser {
  /** Stable id, written into the note's `ink-engine` so a reader knows what ran. */
  readonly id: string;
  /** Whether it works with no network. Everything preferred here does. */
  readonly offline: boolean;
  /** Whether it consumes stroke trajectories rather than bitmaps. */
  readonly online: boolean;
  available(): Promise<boolean>;
  recognise(lines: InkLine[], hints: InkRecognitionHints): Promise<RecognisedLine[]>;
}

/**
 * The engines this build knows of, in the order they are tried (§5.2).
 *
 * One entry, and that is the honest list. `windows-ink` is the desktop engine and
 * costs nothing: `InkAnalyzer` ships with the OS, offline, with its language
 * models and shape recognisers already installed, reached over stdio by a helper
 * executable.
 *
 * **`stroke-ctc-small` and `chromium-hwr` used to be listed here and are gone.**
 * Neither ever existed: there are no stroke-model weights anywhere in this
 * repository, and `chromium-hwr` was described in this very comment as
 * "verified absent even on Windows Chromium, so it is wrapped and never relied
 * on". Listing them made the settings screen report two engines as
 * *unavailable* — "Built-in stroke model — not shipped in this build" — which is
 * a promise in a registry and an admission in the UI, and the reader rightly
 * asked what it was and why it was in their settings at all. A registry of
 * engines the build cannot run is not a plan; it is a list of noes.
 *
 * Their ids are **not** reserved for a later build. That was the original reason
 * for keeping them, and it bought nothing: an id nobody has ever produced a note
 * with does not need recognizing later. If a stroke model is ever trained, it
 * arrives with its own id and its own entry.
 *
 * `myscript` used to be last: a paid cloud recogniser, opt-in through a key in
 * Settings. It is gone, and its absence is a policy rather than a removal — the
 * app's claim about an ink note is that its text is read on the machine, and an
 * engine that has to be switched on is a claim with an exception in it.
 *
 * `trocr` is deliberately **not** here: revision 1's image OCR cost 240–330 MB
 * and 6–20 s a page, and §0.2 retracts it.
 */
export const INK_ENGINES = [
  { id: "windows-ink@1", offline: true, online: true, platform: "desktop-windows" },
] as const;

export type InkEngineId = (typeof INK_ENGINES)[number]["id"];

/** Where an engine can run, so a selector does not offer a desktop-only one. */
export type InkEnginePlatform = (typeof INK_ENGINES)[number]["platform"];

/**
 * The first engine that says it is available, or `null`.
 *
 * `available()` is asked in preference order and may be slow — it probes a
 * helper process or a model cache — so the winner is the caller's to keep for
 * the session rather than re-probing per page. An opt-in engine is passed in by
 * the caller that decided to opt in; this selector does not enable anything by
 * itself, which is what keeps the privacy line honest.
 */
export async function selectInkRecogniser(
  candidates: readonly InkRecogniser[],
): Promise<InkRecogniser | null> {
  const ordered = [...candidates].sort((a, b) => rust().inkEngineRank(a.id) - rust().inkEngineRank(b.id));
  for (const recogniser of ordered) {
    try {
      if (await recogniser.available()) return recogniser;
    } catch {
      // An engine that throws while probing is an engine that is not available.
      // The next one gets its turn rather than the page losing its text layer.
    }
  }
  return null;
}

/**
 * Below this a line is shown dotted in the text layer and can be corrected. Read at
 * call time from the Rust core (`INK_UNSURE_CONFIDENCE`), so there is one number.
 */
export function inkUnsureConfidence(): number {
  return rust().inkUnsureConfidence();
}

/** Whether a recognised line should be marked unsure (Rust `is_unsure_confidence`). */
export function isUnsureLine(line: RecognisedLine): boolean {
  return rust().isUnsureLine(line);
}

/**
 * An engine's own score, mapped to `[0, 1]` (Rust `map_ink_confidence`).
 *
 * Engines report confidence on scales of their own; this clamps and normalises
 * so the threshold above means one thing everywhere. An engine with a different
 * calibration passes `scale`.
 */
export function mapInkConfidence(raw: number, scale = 1): number {
  return rust().mapInkConfidence(raw, scale);
}

/**
 * The mean confidence of a page's lines (Rust `ink_page_confidence`). Lines the
 * user corrected count as certain, so a fix never lowers the number.
 */
export function inkPageConfidence(lines: readonly RecognisedLine[]): number {
  return rust().inkPageConfidence(lines);
}

/**
 * The vocabulary hints handed to an engine (Rust `ink_vocabulary_hints`):
 * titles and citation keys, trimmed, deduplicated case-insensitively and capped.
 */
export function inkVocabularyHints(
  sources: readonly (readonly string[])[],
  limit = 500,
): string[] {
  return rust().inkVocabularyHints(sources, limit);
}
