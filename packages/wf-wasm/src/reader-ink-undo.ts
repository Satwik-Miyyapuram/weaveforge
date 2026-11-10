/**
 * Reader ink undo stack (Rust `reader_ink_undo`), re-exported from index.ts. Each function keeps the
 * signature is InkUndoFns in packages/core/src/shared/core-contract.ts.
 */
import {
  pushInkUndo as rawPushInkUndo,
  refreshInkUndoAnnotation as rawRefreshInkUndoAnnotation,
  renameInkUndoId as rawRenameInkUndoId,
  takeInkRedo as rawTakeInkRedo,
  takeInkUndo as rawTakeInkUndo,
} from "../pkg/wf_wasm.js";
import type { InkUndoEntry, InkUndoState, ZoteroAnnotationLocal as ReaderAnnotation } from "./bindings.js";

/** How many steps are kept. A page of handwriting is a few hundred strokes. */
export const INK_UNDO_LIMIT = 200;

/** Nothing recorded yet. */
export const EMPTY_INK_UNDO: InkUndoState = { undo: [], redo: [] };

/** Record a step. A new step is a new branch: whatever was redoable is gone. */
export function pushInkUndo(state: InkUndoState, entry: InkUndoEntry): InkUndoState {
  return rawPushInkUndo(state, entry) as InkUndoState;
}

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

/** A row was recreated under a new id: point every step at the new one. */
export function renameInkUndoId(state: InkUndoState, from: string, to: string): InkUndoState {
  return rawRenameInkUndoId(state, from, to) as InkUndoState;
}

/** A row was rewritten outside the stack: keep the snapshot every entry holds current. */
export function refreshInkUndoAnnotation(
  state: InkUndoState,
  annotation: ReaderAnnotation,
): InkUndoState {
  return rawRefreshInkUndoAnnotation(state, annotation) as InkUndoState;
}
