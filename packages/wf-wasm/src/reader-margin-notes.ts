/**
 * Margin comment card stacking (Rust `reader_margin_notes`). Keeps the stacking
 * step of apps/web/src/features/reader/application/margin-notes.ts.
 */
import {
  layoutMarginNotes as rawLayoutMarginNotes,
} from "../pkg/wf_wasm.js";
import type {
  MarginSlot,
  ReaderPageProjection,
} from "./bindings.js";

export {
  stackMarginNotes,
} from "../pkg/wf_wasm.js";

export type { MarginSlot } from "./bindings.js";

/** One annotation as margin layout reads it: its comment and picture state, and its mark's geometry. */
export interface MarginMark {
  hasComment: boolean;
  hasPicture: boolean;
  /** Flat `[x1, y1, x2, y2]` rects and `[x, y, ...]` paths in PDF user space; null without a zotero position. */
  geometry: { rects: number[][]; paths: number[][] } | null;
}

/**
 * Margin cards for one page (`layoutMarginNotes` in Rust). Returns `{ index, top, anchorTop }`
 * per card in ascending `anchorTop` order; `index` is the mark's position in `marks`.
 */
export function layoutMarginNotes(
  marks: readonly MarginMark[],
  projection: ReaderPageProjection,
  cardHeight: number,
): MarginSlot[] {
  return rawLayoutMarginNotes(marks, projection, cardHeight) as MarginSlot[];
}

