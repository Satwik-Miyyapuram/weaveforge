/**
 * The one place the response schema lives.
 *
 * JIIX answers with elements whose `label` is the reading; the maths export
 * answers with a bare LaTeX string under a different key. Both are read here,
 * and an element whose label is empty maps to an empty line rather than to a
 * missing one — §4.2's text layer is positional, and dropping a line would
 * shift every line after it.
 */
import { mapInkConfidence } from "../recognise.js";
import type { InkLine, RecognisedLine } from "../recognise.js";
import {
  MYSCRIPT_DEFAULT_CONFIDENCE,
  MYSCRIPT_JIIX_MIME,
  MYSCRIPT_LATEX_MIME,
} from "./vocabulary.js";
import type { MyScriptRequestLine } from "./request.js";

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
 * Map a response onto the note's own lines.
 *
 * **Grouping is by geometry, not by array order.** The elements an export returns
 * are not promised in reading order, and the batch body is flat, so an element is
 * matched to the input line whose vertical centre it is nearest — as a fraction of
 * the page's own height, so the units the service answered in do not matter — within
 * a tolerance drawn from the ink's own line height. Every line the note sent appears
 * exactly once in the result, in the note's order; a line the service did not read
 * comes back with empty text and `conf` `0`, so `isUnsureLine` marks it for
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
export function collectResponseLines(response: MyScriptExportResponse | null): CandidateLine[] {
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
