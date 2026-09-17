/**
 * The one place the request schema lives.
 *
 * Everything upstream calls "the batch request" is assembled here: the scale,
 * the `contentType`, the configuration block and one flat object per stroke. A
 * change to the service's schema — a renamed property, a moved export block, a
 * different pressure range — is an edit to this module and to nothing else,
 * which is the property the plan asks the mapper to have.
 */
import { mapInkConfidence } from "../recognise.js";
import type { InkLine, InkRecognitionHints } from "../recognise.js";
import {
  MYSCRIPT_CONTENT_TYPES,
  MYSCRIPT_DEFAULT_SCALE,
  MYSCRIPT_JIIX_MIME,
  MYSCRIPT_LATEX_MIME,
} from "./vocabulary.js";
import type { MyScriptContentType } from "./vocabulary.js";

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
     * which is why nothing in this folder reads it.
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
 * The one function that builds the batch body.
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
