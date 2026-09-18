/**
 * Undo and redo over pen strokes on a PDF.
 *
 * A stroke is a reader annotation (§1.2 of the pdf-ink plan): creating one is
 * a row written through the sink, erasing one is a row deleted, and joining a
 * stroke to the mark in progress is the row's anchor rewritten. Undo is the
 * inverse of each of those, applied through the same sink, so nothing here
 * touches storage — this is the stack, kept pure so it can be tested without
 * a reader, and so the hook that drives it is only the wiring.
 *
 * An entry carries the whole annotation rather than an id because undoing a
 * removal must recreate the row, and recreating gives it a new id: every entry
 * that named the old id must then be told the new one (`renameInkUndoId`),
 * or a later undo would try to delete a row that no longer exists.
 */

import type { ReaderAnnotation } from "./reader-annotation.js";

export type InkUndoEntry =
  /** A stroke was created; undo removes it, redo creates it again. */
  | { kind: "create"; annotation: ReaderAnnotation }
  /** A stroke was erased; undo creates it again, redo removes it. */
  | { kind: "remove"; annotation: ReaderAnnotation }
  /** A mark's paths were rewritten (a stroke joined it, or it was moved). */
  | {
      kind: "anchor";
      id: string;
      before: ReaderAnnotation["anchor"];
      after: ReaderAnnotation["anchor"];
    };

export interface InkUndoState {
  undo: readonly InkUndoEntry[];
  redo: readonly InkUndoEntry[];
}

export const EMPTY_INK_UNDO: InkUndoState = { undo: [], redo: [] };

/** How many steps are kept. A page of handwriting is a few hundred strokes. */
export const INK_UNDO_LIMIT = 200;

/** Record a step. A new step is a new branch: whatever was redoable is gone. */
export function pushInkUndo(state: InkUndoState, entry: InkUndoEntry): InkUndoState {
  const undo = [...state.undo, entry];
  return { undo: undo.length > INK_UNDO_LIMIT ? undo.slice(-INK_UNDO_LIMIT) : undo, redo: [] };
}

/** The step to undo, moved onto the redo stack; `null` when there is none. */
export function takeInkUndo(
  state: InkUndoState,
): { state: InkUndoState; entry: InkUndoEntry } | null {
  const entry = state.undo[state.undo.length - 1];
  if (!entry) return null;
  return { state: { undo: state.undo.slice(0, -1), redo: [...state.redo, entry] }, entry };
}

/** The step to redo, moved back onto the undo stack; `null` when there is none. */
export function takeInkRedo(
  state: InkUndoState,
): { state: InkUndoState; entry: InkUndoEntry } | null {
  const entry = state.redo[state.redo.length - 1];
  if (!entry) return null;
  return { state: { undo: [...state.undo, entry], redo: state.redo.slice(0, -1) }, entry };
}

/**
 * A row was recreated under a new id: point every step at the new one.
 *
 * Both stacks are rewritten, because an entry on either side may still name
 * the row — the create that first made it, an anchor rewrite that joined a
 * stroke to it, the removal being undone right now.
 */
export function renameInkUndoId(state: InkUndoState, from: string, to: string): InkUndoState {
  if (from === to) return state;
  const rename = (entry: InkUndoEntry): InkUndoEntry => {
    if (entry.kind === "anchor") return entry.id === from ? { ...entry, id: to } : entry;
    if (entry.annotation.id !== from) return entry;
    return { ...entry, annotation: { ...entry.annotation, id: to } };
  };
  return { undo: state.undo.map(rename), redo: state.redo.map(rename) };
}

/**
 * A row was rewritten outside the stack (a stroke joined it): keep the
 * snapshot every entry holds current, so recreating it after an erase brings
 * back the whole mark and not the first stroke of it.
 */
export function refreshInkUndoAnnotation(
  state: InkUndoState,
  annotation: ReaderAnnotation,
): InkUndoState {
  const refresh = (entry: InkUndoEntry): InkUndoEntry =>
    entry.kind !== "anchor" && entry.annotation.id === annotation.id
      ? { ...entry, annotation }
      : entry;
  return { undo: state.undo.map(refresh), redo: state.redo.map(refresh) };
}
