/**
 * Line segmentation: the strokes of a page, grouped into the lines a recogniser
 * can read (§5.4).
 *
 * An online recogniser wants a line of handwriting, not a page — its language
 * model and its word spacing both assume one. Grouping is therefore the step
 * that decides how good recognition can be, and it is done from the trajectory
 * alone: strokes arrive in time order, so a stroke belongs to the line being
 * built when it starts soon enough after it and sits at the same height.
 *
 * Nothing here guesses from a raster. Highlighter and shape strokes are never
 * segmented — they are not writing, and feeding them to an engine as if they
 * were is how a highlight becomes a stray underline in the text layer.
 */

import type { InkLineRecord, InkStroke } from "./ink-note.js";
import type { InkLine } from "./recognise.js";

/** Idle gap after which a stroke starts a new line rather than joining one. */
export const INK_GROUP_WINDOW_MS = 2_000;

/**
 * How far a stroke's centre may sit from the line's, as a fraction of the
 * running median stroke height. 0.6 admits a descender and a capital without
 * letting the line below join in.
 */
export const INK_LINE_BAND_RATIO = 0.6;

/** A stroke's vertical extent, `[yMin, yMax]`, or `null` when it has no points. */
export function inkStrokeBand(stroke: InkStroke): [number, number] | null {
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let i = 1; i < stroke.points.length; i += 2) {
    const y = stroke.points[i]!;
    if (!Number.isFinite(y)) continue;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  if (!Number.isFinite(yMin)) return null;
  return [yMin, yMax];
}

/** The first point's time, or `0` for a stroke that carries none. */
function strokeStartTime(stroke: InkStroke, index: number): number {
  return Number.isFinite(stroke.t0) ? stroke.t0 : index;
}

export interface InkSegmentation {
  /** Lines in reading order, top to bottom. */
  lines: InkLine[];
  /** The line each **input** stroke went into, `-1` when it was not segmented. */
  lineOfStroke: number[];
}

/**
 * Group a page's strokes into lines.
 *
 * The rule, from §5.4: walking the strokes in time order, a stroke joins the
 * current line when its y-centre is within {@link INK_LINE_BAND_RATIO} of the
 * running median stroke height around the line's y-band **and** it started
 * within {@link INK_GROUP_WINDOW_MS} of the line's last stroke. Otherwise it
 * starts a new line. Lines come back sorted top to bottom, which is the order
 * the text layer is written in.
 */
export function segmentInkLines(
  strokes: readonly InkStroke[],
  options: { windowMs?: number; bandRatio?: number } = {},
): InkSegmentation {
  const windowMs = options.windowMs ?? INK_GROUP_WINDOW_MS;
  const bandRatio = options.bandRatio ?? INK_LINE_BAND_RATIO;

  const lineOfStroke = strokes.map(() => -1);
  interface Draft {
    indices: number[];
    yMin: number;
    yMax: number;
    lastAt: number;
    /** Stroke heights, kept sorted so the median is one lookup. */
    heights: number[];
  }
  const drafts: Draft[] = [];

  const order = strokes
    .map((stroke, index) => ({ stroke, index }))
    .filter(({ stroke }) => stroke.tool === "pen" && stroke.points.length >= 4)
    .sort((a, b) => strokeStartTime(a.stroke, a.index) - strokeStartTime(b.stroke, b.index));

  for (const { stroke, index } of order) {
    const band = inkStrokeBand(stroke);
    if (!band) continue;
    const [yMin, yMax] = band;
    const centre = (yMin + yMax) / 2;
    const height = yMax - yMin;
    const at = strokeStartTime(stroke, index);

    const current = drafts[drafts.length - 1];
    let joined = false;
    if (current && at - current.lastAt <= windowMs) {
      const median = medianOfSorted(current.heights);
      const currentCentre = (current.yMin + current.yMax) / 2;
      const tolerance = Math.max(bandRatio * median, 1);
      if (Math.abs(centre - currentCentre) <= tolerance) {
        current.indices.push(index);
        current.yMin = Math.min(current.yMin, yMin);
        current.yMax = Math.max(current.yMax, yMax);
        current.lastAt = Math.max(current.lastAt, at);
        insertSorted(current.heights, height);
        joined = true;
      }
    }
    if (!joined) {
      drafts.push({
        indices: [index],
        yMin,
        yMax,
        lastAt: at,
        heights: [height],
      });
    }
  }

  // Reading order is top to bottom, not the order the lines happened to be
  // written in: a margin note added last still belongs where it sits on the page.
  const ordered = drafts
    .map((draft) => ({ draft, band: [draft.yMin, draft.yMax] as [number, number] }))
    .sort((a, b) => a.band[0] - b.band[0]);

  const lines: InkLine[] = ordered.map(({ draft, band }) => ({
    strokes: draft.indices.map((index) => strokes[index]!),
    yBand: band,
  }));
  ordered.forEach(({ draft }, lineIndex) => {
    for (const index of draft.indices) lineOfStroke[index] = lineIndex;
  });

  return { lines, lineOfStroke };
}

/** Median of an already-sorted array; `0` for an empty one. */
function medianOfSorted(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const middle = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Binary insertion keeps `heights` sorted without re-sorting every stroke. */
function insertSorted(sorted: number[], value: number): void {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle]! < value) low = middle + 1;
    else high = middle;
  }
  sorted.splice(low, 0, value);
}

/** What recognition produced for one line, if anything. */
export interface RecognisedLineText {
  text: string;
  confidence: number;
}

/**
 * Reorder a page's strokes so each line's strokes are contiguous, and build the
 * line records the container stores.
 *
 * The container's line table names a line's strokes as `strokeStart` +
 * `strokeCount` — a contiguous range — while a line's strokes are only
 * contiguous in time order, and lines interleave the moment a margin note or a
 * correction is added. So the order the page is *stored* in is line order, and
 * the stroke's own `lineIndex` is what makes the association explicit either
 * way. Strokes that were never segmented keep their relative order at the end.
 */
export function applyInkSegmentation(
  strokes: readonly InkStroke[],
  segmentation: InkSegmentation,
  recognised: readonly (RecognisedLineText | undefined)[] = [],
): { strokes: InkStroke[]; lines: InkLineRecord[] } {
  const grouped: InkStroke[] = [];
  const lines: InkLineRecord[] = [];

  segmentation.lines.forEach((line, lineIndex) => {
    const strokeStart = grouped.length;
    for (const stroke of line.strokes) {
      grouped.push({ ...stroke, lineIndex });
    }
    const text = recognised[lineIndex];
    lines.push({
      strokeStart,
      strokeCount: grouped.length - strokeStart,
      yMin: Math.round(line.yBand[0]),
      yMax: Math.round(line.yBand[1]),
      text: text?.text ?? "",
      confidence: text?.confidence ?? 0,
    });
  });

  for (const [index, stroke] of strokes.entries()) {
    if (segmentation.lineOfStroke[index] === -1) grouped.push({ ...stroke, lineIndex: -1 });
  }
  return { strokes: grouped, lines };
}

/** The strokes of one line, by the container's range, with a bounds check. */
export function inkLineStrokes(
  strokes: readonly InkStroke[],
  line: InkLineRecord,
): InkStroke[] {
  return strokes.slice(line.strokeStart, line.strokeStart + line.strokeCount);
}
