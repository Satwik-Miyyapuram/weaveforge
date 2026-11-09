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

import type { InkLineRecord, InkPage, InkStroke } from "./ink-note.js";
import { decodeInkChunkBody, type InkChunkView } from "./ink-binary.js";
import { rust } from "../shared/rust.js";

/** One decoder for the module: it holds no state. */
const decoder = new TextDecoder();

/**
 * Walk one stroke's points as absolute coordinates, in 0.1 mm.
 *
 * The deltas are cumulative within a stroke and the chain restarts at each
 * stroke, so this is a single sequential pass over that stroke's own slice.
 */
function walkStroke(
  view: InkChunkView,
  strokeIndex: number,
  visit: (i: number, x: number, y: number, pressure: number) => void,
): void {
  const start = view.strokePointOffset[strokeIndex] ?? 0;
  const count = view.strokePointCount[strokeIndex] ?? 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < count; i += 1) {
    const at = (start + i) * 3;
    x = i === 0 ? view.points[at]! : x + view.points[at]!;
    y = i === 0 ? view.points[at + 1]! : y + view.points[at + 1]!;
    visit(i, x, y, view.points[at + 2]!);
  }
}

/**
 * One stroke's points as absolute coordinates, in 0.1 mm — the shape the page
 * buffer wants before it uploads.
 */
export function chunkStrokePoints(
  view: InkChunkView,
  strokeIndex: number,
): { points: Float64Array; pressures: Uint8Array } {
  const count = view.strokePointCount[strokeIndex] ?? 0;
  const points = new Float64Array(count * 2);
  const pressures = new Uint8Array(count);
  walkStroke(view, strokeIndex, (i, x, y, pressure) => {
    points[i * 2] = x;
    points[i * 2 + 1] = y;
    pressures[i] = pressure;
  });
  return { points, pressures };
}

/** Every point of a page, absolute, in one pass over all of its strokes. */
export function chunkAbsolutePoints(view: InkChunkView): Int16Array {
  const out = new Int16Array(view.pointCount * 3);
  let cursor = 0;
  const write = (_i: number, x: number, y: number, pressure: number) => {
    out[cursor] = x;
    out[cursor + 1] = y;
    out[cursor + 2] = pressure;
    cursor += 3;
  };
  for (let stroke = 0; stroke < view.strokeCount; stroke += 1) walkStroke(view, stroke, write);
  return out;
}

/** One line's text, decoded on demand — nothing walks the blob up front. */
export function chunkLineText(view: InkChunkView, lineIndex: number): string {
  const offset = view.lineTextOffset[lineIndex] ?? 0;
  const length = view.lineTextLength[lineIndex] ?? 0;
  return length === 0 ? "" : decoder.decode(view.texts.subarray(offset, offset + length));
}

/**
 * The whole page as the model (Rust `page_from_chunk_body`).
 *
 * This is the expensive direction on purpose: it materialises numbers for
 * segmentation, recognition, tests and `wf ink dump`, while the renderer reads the
 * views directly. Nothing on the pen path calls it.
 */
export function pageFromChunk(view: InkChunkView): InkPage {
  return rust().pageFromChunkBody(view.body);
}

/** One stroke as the model holds it: absolute points, names, real numbers. */
export function chunkStroke(view: InkChunkView, strokeIndex: number): InkStroke | undefined {
  return pageFromChunk(view).strokes[strokeIndex];
}

/** One line of recognised text as the model holds it. */
export function chunkLine(view: InkChunkView, lineIndex: number): InkLineRecord | undefined {
  return pageFromChunk(view).lines[lineIndex];
}

/** Round-trip an uncompressed body back to the model it was packed from. */
export function pageFromChunkBytes(body: Uint8Array): InkPage {
  return pageFromChunk(decodeInkChunkBody(body));
}
