/**
 * Reading a chunk as the model.
 *
 * The decoder in `ink-binary.ts` produces views — typed arrays over the chunk's
 * own bytes, which is what makes opening a page `O(1)`. This module is the other
 * direction: turning those views into the named, absolute-coordinate model that
 * segmentation, recognition, `wf ink dump` and the tests read.
 *
 * The two are split because they have opposite costs and opposite audiences. The
 * views are what the renderer uses and nothing here may be called on the pen path:
 * {@link pageFromChunk} materialises a number per coordinate, which is exactly
 * what a page buffer exists to avoid doing per frame.
 */

import {
  INK_COLOURS,
  INK_SHAPES,
  INK_TOOLS,
  inkEnumValue,
  makeInkStroke,
  type InkLineRecord,
  type InkPage,
  type InkStroke,
} from "./ink-note.js";
import { INK_PEN_WIDTH } from "./width.js";
import { decodeInkChunkBody, type InkChunkView } from "./ink-binary.js";

/** One decoder for the module: it holds no state. */
const decoder = new TextDecoder();

/**
 * One stroke's points as absolute coordinates, in 0.1 mm.
 *
 * The deltas are cumulative within a stroke and the chain restarts at each stroke,
 * so this is a single sequential pass over that stroke's own slice — which is also
 * the shape the page buffer wants before it uploads.
 */
export function chunkStrokePoints(
  view: InkChunkView,
  strokeIndex: number,
): { points: Float64Array; pressures: Uint8Array } {
  const start = view.strokePointOffset[strokeIndex] ?? 0;
  const count = view.strokePointCount[strokeIndex] ?? 0;
  const points = new Float64Array(count * 2);
  const pressures = new Uint8Array(count);
  let x = 0;
  let y = 0;
  for (let i = 0; i < count; i += 1) {
    const at = (start + i) * 3;
    if (i === 0) {
      x = view.points[at]!;
      y = view.points[at + 1]!;
    } else {
      x += view.points[at]!;
      y += view.points[at + 1]!;
    }
    points[i * 2] = x;
    points[i * 2 + 1] = y;
    pressures[i] = view.points[at + 2]!;
  }
  return { points, pressures };
}

/** Every point of a page, absolute, in one pass over all of its strokes. */
export function chunkAbsolutePoints(view: InkChunkView): Int16Array {
  const out = new Int16Array(view.pointCount * 3);
  let cursor = 0;
  for (let stroke = 0; stroke < view.strokeCount; stroke += 1) {
    const start = view.strokePointOffset[stroke] ?? 0;
    const count = view.strokePointCount[stroke] ?? 0;
    let x = 0;
    let y = 0;
    for (let i = 0; i < count; i += 1) {
      const at = (start + i) * 3;
      if (i === 0) {
        x = view.points[at]!;
        y = view.points[at + 1]!;
      } else {
        x += view.points[at]!;
        y += view.points[at + 1]!;
      }
      out[cursor] = x;
      out[cursor + 1] = y;
      out[cursor + 2] = view.points[at + 2]!;
      cursor += 3;
    }
  }
  return out;
}

/** One line's text, decoded on demand — nothing walks the blob up front. */
export function chunkLineText(view: InkChunkView, lineIndex: number): string {
  const offset = view.lineTextOffset[lineIndex] ?? 0;
  const length = view.lineTextLength[lineIndex] ?? 0;
  return length === 0 ? "" : decoder.decode(view.texts.subarray(offset, offset + length));
}

/** One stroke as the model holds it: absolute points, names, real numbers. */
export function chunkStroke(view: InkChunkView, strokeIndex: number): InkStroke {
  const { points, pressures } = chunkStrokePoints(view, strokeIndex);
  return makeInkStroke({
    points: Array.from(points),
    pressures: Array.from(pressures),
    width: view.strokeWidth[strokeIndex] || INK_PEN_WIDTH,
    tool: inkEnumValue(INK_TOOLS, view.strokeTool[strokeIndex]!),
    colour: inkEnumValue(INK_COLOURS, view.strokeColour[strokeIndex]!),
    shape: inkEnumValue(INK_SHAPES, view.strokeShape[strokeIndex]!),
    t0: view.strokeT0[strokeIndex]!,
    lineIndex: view.strokeLine[strokeIndex]!,
  });
}

/** One line of recognised text as the model holds it. */
export function chunkLine(view: InkChunkView, lineIndex: number): InkLineRecord {
  return {
    strokeStart: view.lineStrokeStart[lineIndex]!,
    strokeCount: view.lineStrokeCount[lineIndex]!,
    yMin: view.lineYMin[lineIndex]!,
    yMax: view.lineYMax[lineIndex]!,
    text: chunkLineText(view, lineIndex),
    // 0–255 on disk, 0–1 in the model, so a correction's `1` survives exactly.
    confidence: (view.lineConfidence[lineIndex] ?? 0) / 255,
  };
}

/**
 * The whole page as the model.
 *
 * This is the expensive direction on purpose: it materialises numbers for
 * segmentation, recognition, tests and `wf ink dump`, while the renderer reads the
 * views directly. Nothing on the pen path calls it.
 */
export function pageFromChunk(view: InkChunkView): InkPage {
  return {
    width: view.width,
    height: view.height,
    paper: view.paper,
    background: view.background,
    strokes: Array.from({ length: view.strokeCount }, (_unused, index) => chunkStroke(view, index)),
    lines: Array.from({ length: view.lineCount }, (_unused, index) => chunkLine(view, index)),
  };
}

/** Round-trip an uncompressed body back to the model it was packed from. */
export function pageFromChunkBytes(body: Uint8Array): InkPage {
  return pageFromChunk(decodeInkChunkBody(body));
}
