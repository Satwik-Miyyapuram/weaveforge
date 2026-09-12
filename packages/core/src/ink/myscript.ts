/**
 * MyScript iink: the opt-in cloud engine, as a recogniser, a mapper, and a
 * maths-to-LaTeX conversion (§5.2, §7 step 10).
 *
 * This is the only engine in {@link INK_ENGINE_ORDER} that is **not** offline, and
 * the only one that sends anything anywhere. §5.2's privacy line is a promise that
 * engines 1–2 never send strokes anywhere and engine 5 does, so three rules are
 * built into this file rather than left to a caller:
 *
 * 1. **Off by default.** Nothing here reads an environment variable, a settings
 *    store or a global. A key is a caller-supplied option and
 *    {@link isMyScriptConfigured} is the gate; an empty or whitespace key is not a
 *    key, because a settings field submits empty strings.
 * 2. **Never enabled without a key.** {@link createMyScriptRecogniser}'s
 *    `available()` resolves `false` when there is no key, so the selector in
 *    `recognise.ts` skips this engine without a network touch. `recognise()` and
 *    {@link convertToLatex} throw instead of silently falling back, because a
 *    caller that asked for MyScript and got something else would be told the note
 *    stayed on the machine when it did not.
 * 3. **The note records the engine.** `id` is `"myscript@1"`, which is what
 *    `ink-engine` in the note's frontmatter is written from (§4.5), so a reviewer
 *    opening the file can see the text was produced off-machine.
 *
 * **This implementation is a stub in one specific sense: no key ships and no call
 * is made here or in the tests.** The interface, the request/response mapping, the
 * gate and a contract test against a *recorded* response are the whole of step 10;
 * the caller passes a real key when the owner decides to pay for one, and the first
 * real call is the one that leaves the machine.
 *
 * ## The upstream shape, and why the mapping is one function each way
 *
 * iinkTS' HTTP batch client (`src/client/HTTPClientV2.ts`) POSTs to
 * `…/api/v4.0/iink/recognize` with a JSON body of `scaleX`/`scaleY`,
 * `contentType`, `configuration` and one flat object per **stroke** — `id`,
 * `pointerType` and parallel `x`/`y`/`t`/`p` arrays. What comes back is keyed by
 * MIME type: `application/vnd.myscript.jiix` for text (`elements[]` of `Text` and
 * `Math` elements carrying a `label` and `candidates`), and `application/x-latex`
 * for maths, which is a **string** rather than an element tree.
 *
 * Three consequences are load-bearing here, and all three are why the mapper is
 * factored rather than inlined:
 *
 * - **The "endpoint" in the plan is a parameter, not a second URL.** There is one
 *   URL; `contentType: "Text"` produces JIIX text and `contentType: "Math"` with
 *   the LaTeX export produces the maths, so maths → LaTeX is *the same endpoint
 *   with a different `contentType` and `export.mimeTypes`*.
 *   {@link myScriptRequestBody} is the single place that knows that, which is what
 *   "a schema change is one function" is supposed to mean.
 * - **The service sees strokes, not lines, and answers with elements.** The batch
 *   body is flat, so lines are flattened into one stroke list; the response is
 *   grouped back into lines by each element's position relative to the page, because
 *   JIIX carries a `bounding-box` and neither the element order nor the units it
 *   answered in are part of the contract.
 * - **Everything the caller sees comes back through those two functions**, and
 *   nothing else in this file knows a property name.
 *
 * **What does not survive the round trip:** vocabulary hints and confidence. The
 * v4 batch endpoint documents no word-list parameter, so `hints.vocabulary` is
 * dropped for the same reason `InkAnalyzer` drops it (§5.3's measured note: the
 * §5.4 post-match is the only path that helps). JIIX reports no per-line score, so
 * every mapped line carries {@link MYSCRIPT_DEFAULT_CONFIDENCE} — a constant of
 * the format rather than an invented measurement, for the same reason the Windows
 * helper reports `1`/`0` instead of guessing. One further loss is stated where it
 * happens: the note keeps one time per stroke, so the service sees a straight time
 * ramp rather than true velocity ({@link myScriptRequestBody}).
 */

import type {
  InkLine,
  InkRecognitionHints,
  InkRecogniser,
  RecognisedLine,
} from "./recognise.js";
import { mapInkConfidence } from "./recognise.js";

/* -------------------------------------------------------------------------
 * Vocabulary
 * ---------------------------------------------------------------------- */

/**
 * The id written into a note's `ink-engine` (§5.2).
 *
 * Declared and exported as well as used below so a caller can compare against it:
 * the note-records-the-engine rule is only useful if the string in the file and
 * the string in the selector agree.
 */
export const MYSCRIPT_ENGINE_ID = "myscript@1";

/** The iink server iinkTS itself defaults to; overridable for a self-hosted one. */
export const MYSCRIPT_DEFAULT_HOST = "cloud.myscript.com";

/** The one URL the batch client posts to, text and maths alike. */
export const MYSCRIPT_ENDPOINT_PATH = "/api/v4.0/iink/recognize";

/** JIIX: the element tree that text recognition comes back as. */
export const MYSCRIPT_JIIX_MIME = "application/vnd.myscript.jiix";

/** LaTeX: what a maths conversion returns, as a bare string. */
export const MYSCRIPT_LATEX_MIME = "application/x-latex";

/**
 * The `contentType` switch that makes one URL two "endpoints".
 *
 * `Text` is handwriting-to-text; `Math` is handwriting-to-LaTeX and is what
 * {@link convertToLatex} asks for. They are not two hosts or two paths — the
 * plan's wording ("maths → LaTeX … documented as a separate endpoint/parameter")
 * is this parameter.
 */
export const MYSCRIPT_CONTENT_TYPES = { text: "Text", math: "Math" } as const;

/** One of the two recognition types the endpoint switches on. */
export type MyScriptContentType =
  (typeof MYSCRIPT_CONTENT_TYPES)[keyof typeof MYSCRIPT_CONTENT_TYPES];

/**
 * The confidence every line from this engine carries.
 *
 * JIIX has no per-line score, and inventing one would make §5.4's dotted underline
 * claim to know which lines are doubtful. `0.9` is above `INK_UNSURE_CONFIDENCE`,
 * so a mapped page does not render entirely dotted; it is a property of the
 * format, not a measurement of the hand.
 */
export const MYSCRIPT_DEFAULT_CONFIDENCE = 0.9;

/**
 * What one unit of our coordinates is worth to the service, in millimetres.
 *
 * iinkTS sends `0.265` by default, which is a millimetre-per-unit ratio for a
 * canvas measured in CSS pixels. Ink note coordinates are tenths of a millimetre
 * (§4.4), so one unit is `0.1` mm and the honest value is `0.1`. It is an option
 * as well as a constant because the server only needs the two axes to agree with
 * each other, and a caller that disagrees can say so. It is **not** used to place a
 * response: the mapping compares an element's position with a line's as fractions
 * of one page extent, so an answer in other units still maps.
 */
export const MYSCRIPT_DEFAULT_SCALE = 0.1;

/** How long a batch call may take before the caller is told the service is stuck. */
export const MYSCRIPT_DEFAULT_TIMEOUT_MS = 20_000;

/* -------------------------------------------------------------------------
 * The opt-in gate
 * ---------------------------------------------------------------------- */

/** The shape this module needs from `fetch`, and nothing more. */
export type MyScriptFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/**
 * The key and server a caller opted into.
 *
 * There is no default key and no other source for one: this type with no
 * `applicationKey` is the off position, and {@link isMyScriptConfigured} is what
 * turns "off" into a boolean a selector can read. `fetch` is injected rather than
 * read from a global for the same reason — the gate must not be openable by
 * anything ambient.
 */
export interface MyScriptOptions {
  /** The MyScript application key. Absent, empty or whitespace means off. */
  applicationKey?: string | null;
  /** `https` unless a self-hosted iink says otherwise. */
  scheme?: string;
  /** Host, defaulting to {@link MYSCRIPT_DEFAULT_HOST}. */
  host?: string;
  /** Injected for tests and for a runtime whose `fetch` is not on `globalThis`. */
  fetch?: MyScriptFetch;
  /** A batch call's budget, defaulting to {@link MYSCRIPT_DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** The scale sent to the server, defaulting to {@link MYSCRIPT_DEFAULT_SCALE}. */
  scale?: number;
}

/**
 * Whether a key was actually supplied.
 *
 * A blank string is not a key, so this trims before it decides. Nothing else is
 * consulted, which is the whole reason {@link MyScriptOptions} has no environment
 * or storage field: opting in is an argument, and only an argument.
 */
export function isMyScriptConfigured(options: MyScriptOptions = {}): boolean {
  const key = options.applicationKey;
  return typeof key === "string" && key.trim().length > 0;
}

/* -------------------------------------------------------------------------
 * The batch request body — one function, because the schema may drift
 * ---------------------------------------------------------------------- */

/** One stroke as the batch body sends it: parallel arrays, not coordinate pairs. */
export interface MyScriptStrokeBody {
  id: string;
  /** `pen` for a stylus, `touch` for a finger. */
  pointerType: string;
  x: number[];
  y: number[];
  /** Times in milliseconds, monotonic within the stroke. */
  t: number[];
  /** Pressure normalised to `[0, 1]`, which is the range iinkTS sends. */
  p: number[];
}

/** How one line is flattened into the batch body. */
export interface MyScriptRequestLine {
  /** Position of the line in the array the body was built from. */
  index: number;
  /** Our own id for it, `line-<n>`, so a log line can name a line. */
  id: string;
  /** The line's extent, which is how the response is matched back. */
  yBand: [number, number];
}

/** The batch body, exactly as the endpoint receives it. */
export interface MyScriptRequestBody {
  scaleX: number;
  scaleY: number;
  contentType: string;
  configuration: {
    lang: string;
    /** Present for text recognition; absent for maths, as upstream builds it. */
    text?: { mimeTypes: string[] };
    /** Present for maths recognition; the property name is `math`. */
    math?: { mimeTypes: string[] };
    export: { mimeTypes: string[] };
    /**
     * Which lines were sent, for a log line only.
     *
     * iink ignores unknown properties, and the mapping back is done from each
     * element's own position, so this is a debugging aid rather than a contract —
     * which is why nothing in this file reads it.
     */
    mapping?: Record<string, number>;
  };
  strokes: MyScriptStrokeBody[];
}

/** The body, plus the line table the response is mapped back through. */
export interface MyScriptRequest {
  body: MyScriptRequestBody;
  /** The lines the body was built from, in the order they were sent. */
  lines: MyScriptRequestLine[];
}

/** What {@link myScriptRequestBody} needs to know besides the strokes. */
export interface MyScriptRequestOptions {
  /** `Math` asks the same endpoint for a derivation; the default is `Text`. */
  contentType?: MyScriptContentType;
  /** The export MIME types to ask for; defaults to JIIX for text, LaTeX for maths. */
  mimeTypes?: readonly string[];
  /** BCP 47 tag from the hints; `en` where the caller has none. */
  lang?: string;
  /** Defaults to {@link MYSCRIPT_DEFAULT_SCALE}. */
  scale?: number;
}

/**
 * The one place the request schema lives.
 *
 * Everything upstream calls "the batch request" is assembled here: the scale, the
 * `contentType`, the configuration block and one flat object per stroke. A change
 * to the service's schema — a renamed property, a moved export block, a different
 * pressure range — is an edit to this function and to nothing else, which is the
 * property the plan asks the mapper to have.
 *
 * Three upstream details are deliberate rather than accidental:
 *
 * - **`configuration.export` always carries the requested MIME types**, and
 *   `configuration.text`/`configuration.math` carry the same list for the matching
 *   content type, because that is how iinkTS' own `postConfig` builds the block.
 * - **Pressure is normalised to `[0, 1]`.** The note stores 0–255 (§4.4) and the
 *   service documents `0`–`1`; sending 255 is how a stroke comes back a scribble.
 * - **Time is a ramp.** The note keeps one time per stroke (`t0`) and none per
 *   point (§4.4), so the trajectory the service sees has direction and order but
 *   not true velocity. That is the one input this engine gets less of than Windows
 *   Ink, and it is stated here rather than papered over, because §5.3's argument
 *   for online recognition is that the trajectory is already there.
 */
export function myScriptRequestBody(
  lines: readonly InkLine[],
  hints: Pick<InkRecognitionHints, "lang"> = { lang: "en" },
  options: MyScriptRequestOptions = {},
): MyScriptRequest {
  const contentType = options.contentType ?? MYSCRIPT_CONTENT_TYPES.text;
  const maths = contentType === MYSCRIPT_CONTENT_TYPES.math;
  const mimeTypes = [
    ...(options.mimeTypes ?? [maths ? MYSCRIPT_LATEX_MIME : MYSCRIPT_JIIX_MIME]),
  ];
  const scale = options.scale ?? MYSCRIPT_DEFAULT_SCALE;

  const strokes: MyScriptStrokeBody[] = [];
  const table: MyScriptRequestLine[] = [];
  lines.forEach((line, index) => {
    const id = `line-${index}`;
    table.push({ index, id, yBand: line.yBand });
    line.strokes.forEach((stroke, strokeIndex) => {
      // A stroke with no drawable segment is not sent: the service rejects a
      // stroke with too few points, and one such stroke would fail the whole page
      // rather than the line it came from.
      if (stroke.points.length < 4) return;
      strokes.push({
        id: `${id}-s${strokeIndex}`,
        pointerType: "pen",
        x: everyOtherPoint(stroke.points, 0),
        y: everyOtherPoint(stroke.points, 1),
        t: pointTimes(stroke.points, stroke.t0),
        p: strokePressures(stroke.pressures, Math.floor(stroke.points.length / 2)),
      });
    });
  });

  const shared = { lang: hints.lang, export: { mimeTypes }, mapping: lineMapping(table) };
  const configuration: MyScriptRequestBody["configuration"] = maths
    ? { ...shared, math: { mimeTypes } }
    : { ...shared, text: { mimeTypes } };

  return {
    body: { scaleX: scale, scaleY: scale, contentType, configuration, strokes },
    lines: table,
  };
}

/**
 * Every other entry of a flat `[x, y, …]` list: the `x`s, or the `y`s at `+1`.
 *
 * The result keeps one entry per point, `0` where a coordinate is not finite,
 * because the body's `x`/`y`/`t`/`p` arrays are **parallel**: dropping an entry
 * from one would slide every later point of that stroke against its own pressure
 * and time, which reads to the service as a different stroke rather than a broken
 * one.
 */
function everyOtherPoint(points: readonly number[], offset: number): number[] {
  const out: number[] = [];
  for (let i = offset; i < points.length; i += 2) {
    const value = points[i];
    out.push(typeof value === "number" && Number.isFinite(value) ? value : 0);
  }
  return out;
}

/** A time per point, in milliseconds, as the straight ramp described above. */
function pointTimes(points: readonly number[], t0: number): number[] {
  const count = Math.floor(points.length / 2);
  const start = Number.isFinite(t0) ? t0 : 0;
  return Array.from({ length: count }, (_, index) => start + index);
}

/** Pressure per point, normalised to `[0, 1]`, or a flat `1` where there is none. */
function strokePressures(pressures: readonly number[], count: number): number[] {
  if (pressures.length !== count) return Array.from({ length: count }, () => 1);
  return pressures.map((value) => (Number.isFinite(value) ? mapInkConfidence(value, 255) : 0));
}

/** Which lines were sent, for a log line; the service ignores unknown properties. */
function lineMapping(table: readonly MyScriptRequestLine[]): Record<string, number> {
  const mapping: Record<string, number> = {};
  for (const line of table) mapping[line.id] = line.index;
  return mapping;
}

/* -------------------------------------------------------------------------
 * The response — the other one function
 * ---------------------------------------------------------------------- */

/** One line as JIIX reports it. */
export interface MyScriptResponseElement {
  id?: string;
  /** `"Text"`, `"Math"`, `"Drawing"` or a shape kind. */
  type?: string;
  /** The reading the engine settled on; LaTeX for a maths element. */
  label?: string;
  /** Other readings, best first — §5.4's correction UI wants these. */
  candidates?: string[];
  /** `[x, y, width, height]`, in the service's coordinates. */
  "bounding-box"?: [number, number, number, number];
  /** Baseline information, the more precise of the two descriptions of position. */
  lines?: readonly { "baseline-y"?: number; "x-height"?: number }[];
}

/**
 * The part of an iink export this module reads: a map keyed by MIME type.
 *
 * Text and maths answers have different shapes under the same key set. `elements`
 * and `words` are both element lists and either may carry the labels; the value
 * under the JIIX key may itself be a string, for a service that answered
 * `text/plain` under a JIIX request; and the LaTeX key is a string by definition.
 */
export interface MyScriptExportResponse {
  [mimeType: string]: unknown;
}

/** One reading found in a response, with the geometry the matching needs. */
interface CandidateLine {
  /** Where the reading sat in the flattened response, in the order it was listed. */
  position: number;
  text: string;
  alternatives: string[];
  /** Vertical centre in the service's coordinates, or `null` if it said nothing. */
  yCentre: number | null;
}

/**
 * The one place the response schema lives.
 *
 * JIIX answers with elements whose `label` is the reading; the maths export
 * answers with a bare LaTeX string under a different key. Both are read here, and
 * an element whose label is empty maps to an empty line rather than to a missing
 * one — §4.2's text layer is positional, and dropping a line would shift every
 * line after it.
 *
 * **Grouping is by geometry, not by array order.** The elements an export returns
 * are not promised in reading order, and the batch body is flat, so an element is
 * matched to the input line whose vertical centre it is nearest — as a fraction of
 * the page's own height, so the units the service answered in do not matter — within
 * a tolerance drawn from the ink's own line height. Every line the note sent appears
 * exactly once in the result, in the note's order; a line the service did not read
 * comes back with empty text and `conf` `0`, so {@link isUnsureLine} marks it for
 * the correction UI instead of it vanishing.
 */
export function myScriptRecognisedLines(
  response: MyScriptExportResponse | null,
  lines: readonly InkLine[],
  requestLines: readonly MyScriptRequestLine[] = [],
): RecognisedLine[] {
  const found = collectResponseLines(response);
  const matched = matchLines(lines, requestLines, found);

  return lines.map((_line, index): RecognisedLine => {
    const hit = matched.get(index);
    if (!hit || hit.text.length === 0) {
      // Nothing was read for this line. `0` is below INK_UNSURE_CONFIDENCE, so the
      // line is offered for correction rather than presented as certain.
      return { text: "", conf: 0 };
    }
    const alternatives = hit.alternatives.filter((value) => value !== hit.text);
    const recognised: RecognisedLine = {
      text: hit.text,
      conf: mapInkConfidence(MYSCRIPT_DEFAULT_CONFIDENCE),
    };
    if (alternatives.length > 0) recognised.alternatives = alternatives;
    return recognised;
  });
}

/**
 * Deal a response's readings out to the note's lines.
 *
 * **Closest pair first, not first reading first.** Every within-tolerance
 * (element, line) pair is sorted by distance and assigned nearest-first, so a
 * service that lists a page bottom-up cannot move two lines' text into each
 * other — a first-come assignment would let the first element listed take the
 * line a later element is nearer to, and the later one would then have nowhere to
 * go. Each element claims at most one line, and an element that cannot be placed
 * is dropped rather than guessed at.
 *
 * Elements with no geometry at all cannot be placed that way, so they are dealt
 * out last, in the order the service listed them, to the lines still free: the
 * request is the line list in order, so the nth positionless reading belongs to
 * the nth line the request sent.
 */
function matchLines(
  lines: readonly InkLine[],
  requestLines: readonly MyScriptRequestLine[],
  found: readonly CandidateLine[],
): Map<number, CandidateLine> {
  const matched = new Map<number, CandidateLine>();
  // The answer is placed by *relative* vertical position, never by unit
  // conversion: the service is handed a scale and may answer in its own units, and
  // a matching rule that has to know which would silently place nothing the day
  // the convention changed. So both sides are divided by the page's own extent,
  // which is the largest coordinate either can carry, and compared as fractions
  // of the same height.
  const extent = Math.max(
    1,
    ...lines.flatMap((line) => [Math.abs(line.yBand[0]), Math.abs(line.yBand[1])]),
    ...found.map((candidate) => Math.abs(candidate.yCentre ?? 0)),
  );
  const bandOf = (line: InkLine): number | null => {
    if (!Number.isFinite(line.yBand[0]) || !Number.isFinite(line.yBand[1])) return null;
    return (line.yBand[0] + line.yBand[1]) / 2 / extent;
  };
  const tolerance = lineHeightTolerance(lines) / extent;

  const pairs: { element: number; line: number; distance: number }[] = [];
  found.forEach((candidate, element) => {
    if (candidate.yCentre === null || !Number.isFinite(candidate.yCentre)) return;
    const yCentre = candidate.yCentre / extent;
    lines.forEach((line, index) => {
      const centre = bandOf(line);
      if (centre === null) return;
      const distance = Math.abs(yCentre - centre);
      // A non-finite tolerance means every line has a degenerate band; accepting
      // the pair is then the honest reading, because there is nothing to prefer.
      if (!Number.isFinite(tolerance) || distance <= tolerance) {
        pairs.push({ element, line: index, distance });
      }
    });
  });
  pairs.sort((a, b) => a.distance - b.distance || a.element - b.element);

  const claimed = new Set<number>();
  for (const pair of pairs) {
    if (claimed.has(pair.element) || matched.has(pair.line)) continue;
    const candidate = found[pair.element];
    if (!candidate) continue;
    claimed.add(pair.element);
    matched.set(pair.line, candidate);
  }

  for (const candidate of found) {
    if (claimed.has(candidate.position) || candidate.yCentre !== null) continue;
    const index = requestLines[candidate.position]?.index ?? candidate.position;
    if (index < lines.length && !matched.has(index)) {
      claimed.add(candidate.position);
      matched.set(index, candidate);
    }
  }
  return matched;
}

/** Every reading in an export, flattened, in the order the service listed them. */
function collectResponseLines(response: MyScriptExportResponse | null): CandidateLine[] {
  if (!response) return [];
  const out: CandidateLine[] = [];

  for (const [mimeType, payload] of Object.entries(response)) {
    if (mimeType === MYSCRIPT_LATEX_MIME) {
      // A maths export is the LaTeX itself, as a string; there are no elements and
      // therefore no per-line split to make.
      if (typeof payload === "string" && payload.trim().length > 0) {
        out.push({ position: out.length, text: payload, alternatives: [], yCentre: null });
      }
      continue;
    }
    if (mimeType !== MYSCRIPT_JIIX_MIME || !payload || typeof payload !== "object") continue;
    const record = payload as { elements?: unknown; words?: unknown };
    // `elements` is the v4 shape and `words` the older one; reading both costs a
    // line and means a service that renamed the list still maps.
    for (const list of [record.elements, record.words]) {
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        if (!entry || typeof entry !== "object") continue;
        const element = entry as MyScriptResponseElement;
        const text = typeof element.label === "string" ? element.label : "";
        const candidates = Array.isArray(element.candidates)
          ? element.candidates.filter((value): value is string => typeof value === "string")
          : [];
        out.push({
          position: out.length,
          text,
          alternatives: candidates.filter((value) => value !== text),
          yCentre: elementYCentre(element),
        });
      }
    }
  }
  return out;
}

/**
 * An element's vertical centre, in whatever coordinates the service used.
 *
 * JIIX offers two descriptions of position and both are read: a text element
 * carries `lines[]` with a `baseline-y` and an `x-height`, which is the more
 * precise of the two for a single line of writing, and `bounding-box` is the
 * fallback, `[x, y, width, height]`. `null` means the service said nothing about
 * where the element is, and such an element is matched by request order instead.
 * Nothing here assumes a unit: the matching compares fractions of one page.
 */
function elementYCentre(element: MyScriptResponseElement): number | null {
  const first = element.lines?.[0];
  const baseline = first?.["baseline-y"];
  const xHeight = first?.["x-height"];
  if (typeof baseline === "number" && Number.isFinite(baseline)) {
    return baseline - (typeof xHeight === "number" && Number.isFinite(xHeight) ? xHeight / 2 : 0);
  }
  const box = element["bounding-box"];
  if (Array.isArray(box) && box.length >= 4) {
    const y = box[1];
    const height = box[3];
    if (typeof y === "number" && typeof height === "number" && height > 0) return y + height / 2;
  }
  return null;
}

/**
 * How far an element's centre may sit from a line's and still be that line, as a
 * fraction of the page's extent.
 *
 * One and a half times the median ink line height: enough for a descender and a
 * mis-measured bounding box, not enough to reach the line below. The answer is in
 * ink units, and the caller divides both it and every position by the same page
 * extent, so it survives a service that answered in other units altogether. The
 * floor of `3` is in ink units (0.3 mm), so a page of very small marks does not
 * collapse every line onto the first.
 */
function lineHeightTolerance(lines: readonly InkLine[]): number {
  const heights = lines
    .map((line) => line.yBand[1] - line.yBand[0])
    .filter((height) => Number.isFinite(height) && height > 0)
    .sort((a, b) => a - b);
  if (heights.length === 0) return Number.POSITIVE_INFINITY;
  const middle = heights[Math.floor(heights.length / 2)] ?? 0;
  return Math.max(3, middle * 1.5);
}

/* -------------------------------------------------------------------------
 * Maths → LaTeX, on demand (§7 step 10)
 * ---------------------------------------------------------------------- */

/** A converted derivation: the LaTeX, and the other readings the engine offered. */
export interface MyScriptLatex {
  /** The LaTeX body, without the `$$` fences. */
  latex: string;
  /** Other readings, best first, for a correction UI. */
  alternatives?: string[];
}

/**
 * A maths line as the note writes it: a `$$` block (§7 step 10).
 *
 * The fences are added here rather than by the caller so the fenced and unfenced
 * forms cannot drift apart: {@link convertToLatex} returns the block, and
 * {@link MyScriptLatex.latex} stays bare for a caller that wants to preview the
 * body inline without stripping markers back off.
 */
export function latexBlock(latex: string): string {
  return `$$\n${latex.trim()}\n$$`;
}

/**
 * The LaTeX in one response, when the request asked for maths.
 *
 * This is the response half of {@link convertToLatex}: it reads whichever shape
 * the service answered with — the dedicated `application/x-latex` string first,
 * because that is the one the maths content type guarantees, then an element's
 * label — and returns the alternatives alongside it. An empty answer is an empty
 * `latex`, never a thrown error: a conversion that found nothing is a fact about
 * the handwriting, while a failed conversion is a fact about the call.
 */
export function myScriptLatex(response: MyScriptExportResponse | null): MyScriptLatex {
  if (!response) return { latex: "" };
  const direct = response[MYSCRIPT_LATEX_MIME];
  if (typeof direct === "string" && direct.trim().length > 0) {
    return { latex: direct.trim() };
  }

  const first = collectResponseLines(response).find((entry) => entry.text.length > 0);
  if (!first) return { latex: "" };
  return first.alternatives.length > 0
    ? { latex: first.text, alternatives: [...first.alternatives] }
    : { latex: first.text };
}

/* -------------------------------------------------------------------------
 * The engine
 * ---------------------------------------------------------------------- */

/** The engine, plus the maths conversion that is not part of the shared interface. */
export interface MyScriptRecogniser extends InkRecogniser {
  /**
   * Maths → LaTeX through the same endpoint, with the maths `contentType`.
   *
   * Not on {@link InkRecogniser} because it is the one engine-specific capability
   * in §5.2's row for this engine, and putting it on the shared interface would
   * make every offline engine answer a question it cannot.
   */
  convertMaths(request: MyScriptRequest): Promise<MyScriptLatex>;
}

/**
 * Build the engine.
 *
 * `available()` is a pure gate — a key was supplied or it was not — and makes no
 * network call, so the selector in `recognise.ts` can ask every engine in
 * preference order without a MyScript round trip for a user who never opted in.
 * The first *real* call is the one that leaves the machine, which is the moment
 * §5.2's "one dialog that says so, once" is about.
 *
 * `recognise()` throws when there is no key rather than resolving to empty lines.
 * An engine that answered "nothing recognised" without a key would be worse than
 * useless: the text layer would be rewritten with blanks and the note would record
 * an engine that never ran.
 */
export function createMyScriptRecogniser(options: MyScriptOptions = {}): MyScriptRecogniser {
  const timeoutMs = options.timeoutMs ?? MYSCRIPT_DEFAULT_TIMEOUT_MS;

  /** The URL the batch body is posted to; scheme and host both come from options. */
  const url = `${options.scheme ?? "https"}://${options.host ?? MYSCRIPT_DEFAULT_HOST}${MYSCRIPT_ENDPOINT_PATH}`;

  /**
   * Send one batch body and decode the answer.
   *
   * The key travels as a header, never in the body, which is what keeps it out of
   * any log that records a request payload — iinkTS' own client posts it the same
   * way, in `post()`. The answer is read as text first so a non-JSON error page
   * becomes the error message rather than a JSON parse failure.
   */
  const post = async (request: MyScriptRequest): Promise<MyScriptExportResponse> => {
    const key = options.applicationKey;
    if (!isMyScriptConfigured(options)) {
      throw new Error("MyScript is not available: no application key was supplied (§5.2).");
    }
    const send = options.fetch ?? (globalThis.fetch as unknown as MyScriptFetch | undefined);
    if (typeof send !== "function") {
      throw new Error("MyScript needs a fetch implementation, and this runtime has none.");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await send(url, {
        method: "POST",
        headers: {
          applicationKey: (key as string).trim(),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(request.body),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(
          `MyScript answered ${response.status}: ${text.slice(0, 200) || "no detail"}`,
        );
      }
      try {
        return JSON.parse(text) as MyScriptExportResponse;
      } catch {
        throw new Error("MyScript answered with something that is not JSON.");
      }
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    id: MYSCRIPT_ENGINE_ID,
    // The two facts the selector and the note read: this engine is not offline and
    // it is an online (trajectory) engine, which is the distinction §5.1 calls
    // load-bearing.
    offline: false,
    online: true,

    async available(): Promise<boolean> {
      // A gate, not a probe: no key, no engine, and no packet.
      return isMyScriptConfigured(options);
    },

    async recognise(
      lines: InkLine[],
      hints: InkRecognitionHints,
    ): Promise<RecognisedLine[]> {
      const request = myScriptRequestBody(lines, hints, {
        contentType: MYSCRIPT_CONTENT_TYPES.text,
        ...(options.scale === undefined ? {} : { scale: options.scale }),
      });
      const response = await post(request);
      // The request's line table goes in with the response: it is what places an
      // element the service gave no geometry for.
      return myScriptRecognisedLines(response, lines, request.lines);
    },

    async convertMaths(request: MyScriptRequest): Promise<MyScriptLatex> {
      const response = await post(request);
      return myScriptLatex(response);
    },
  };
}

/**
 * The maths-to-LaTeX conversion the plan asks for, on demand.
 *
 * Takes one ink line and returns the LaTeX in a `$$` block with the alternatives
 * the engine offered. It is a free function rather than a method because the plan's
 * wording is "a derivation converts on demand": the call site decides when, and
 * nothing in this module ever converts on its own.
 *
 * It throws when no key was supplied rather than returning an empty string. An
 * empty conversion and a refused one look identical downstream, and only one of
 * them means the text stayed on this machine.
 */
export async function convertToLatex(
  line: InkLine,
  options: MyScriptOptions & {
    /** BCP 47 tag for the derivation; `en` where the caller has none. */
    lang?: string;
    /** Convert through an engine the caller already built, rather than a fresh one. */
    recogniser?: Pick<MyScriptRecogniser, "convertMaths">;
    /** A pre-built maths request, so a caller with several lines makes one call. */
    request?: MyScriptRequest;
  } = {},
): Promise<{ latex: string; alternatives?: string[] }> {
  if (!isMyScriptConfigured(options)) {
    throw new Error(
      "MyScript is not configured: no application key was supplied, and this engine never runs without one (§5.2).",
    );
  }
  const request =
    options.request ??
    myScriptRequestBody(
      [line],
      { lang: options.lang ?? "en" },
      {
        contentType: MYSCRIPT_CONTENT_TYPES.math,
        ...(options.scale === undefined ? {} : { scale: options.scale }),
      },
    );
  const engine =
    options.recogniser ??
    createMyScriptRecogniser({
      applicationKey: options.applicationKey,
      ...(options.scheme === undefined ? {} : { scheme: options.scheme }),
      ...(options.host === undefined ? {} : { host: options.host }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.scale === undefined ? {} : { scale: options.scale }),
    });
  const converted = await engine.convertMaths(request);
  const latex = latexBlock(converted.latex);
  return converted.alternatives && converted.alternatives.length > 0
    ? { latex, alternatives: [...converted.alternatives] }
    : { latex };
}
