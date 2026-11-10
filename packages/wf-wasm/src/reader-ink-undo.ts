/**
 * Reader ink undo stack (Rust `reader_ink_undo`), re-exported from index.ts. Each function keeps the
 * signature is InkUndoFns in packages/core/src/shared/core-contract.ts.
 */
import {
  takeInkRedo as rawTakeInkRedo,
  takeInkUndo as rawTakeInkUndo,
} from "../pkg/wf_wasm.js";
import type {
  InkUndoEntry,
  InkUndoState,
} from "./bindings.js";

export {
  pushInkUndo,
  refreshInkUndoAnnotation,
  renameInkUndoId,
} from "../pkg/wf_wasm.js";

/** How many steps are kept. A page of handwriting is a few hundred strokes. */
export const INK_UNDO_LIMIT = 200;

/** Nothing recorded yet. */
export const EMPTY_INK_UNDO: InkUndoState = { undo: [], redo: [] };

/** The step to undo, moved onto the redo stack; `null` when there is none. */
export function takeInkUndo(
  state: InkUndoState,
): { state: InkUndoState; entry: InkUndoEntry } | null {
  return rawTakeInkUndo(state) as { state: InkUndoState; entry: InkUndoEntry } | null;
}

/** The step to redo, moved back onto the undo stack; `null` when there is none. */
export function takeInkRedo(
  state: InkUndoState,
): { state: InkUndoState; entry: InkUndoEntry } | null {
  return rawTakeInkRedo(state) as { state: InkUndoState; entry: InkUndoEntry } | null;
}

