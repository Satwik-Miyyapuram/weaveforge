/**
 * Margin comment card stacking (Rust `reader_margin_notes`). Keeps the stacking
 * step of apps/web/src/features/reader/application/margin-notes.ts.
 */
import { stackMarginNotes as rawStackMarginNotes } from "../pkg/wf_wasm.js";
import type { MarginSlot } from "./bindings.js";

export type { MarginSlot } from "./bindings.js";

/**
 * Stacks cards of `cardHeight` down the margin, one per entry of `anchorTops`,
 * in ascending `anchorTop` order.
 */
export function stackMarginNotes(anchorTops: readonly number[], cardHeight: number): MarginSlot[] {
  return rawStackMarginNotes(anchorTops, cardHeight) as MarginSlot[];
}
