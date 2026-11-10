/**
 * Press snapping for the text layer (Rust `reader_text_snap`). Keeps the
 * shape of apps/web/src/features/reader/ui/pdf-reader/text-snap.ts. Callers
 * pass plain boxes copied from `getBoundingClientRect()`, not DOMRects, since
 * DOMRect getters do not cross the wasm boundary.
 */
import { snapToText as rawSnapToText } from "../pkg/wf_wasm.js";
import type { TextRunBox } from "./bindings.js";

export type { SnapHit, TextRunBox } from "./bindings.js";

/**
 * The text run nearest a press beside the words, or null when none is in reach. Rust always fills the caret
 * position, so the wrapper narrows the generated `number | null` fields.
 */
export function snapToText(runs: readonly TextRunBox[], x: number, y: number): { index: number; x: number; y: number } | null {
  return rawSnapToText(
    runs.map((run) => ({ left: run.left, top: run.top, right: run.right, bottom: run.bottom })),
    x,
    y,
  ) as { index: number; x: number; y: number } | null;
}
