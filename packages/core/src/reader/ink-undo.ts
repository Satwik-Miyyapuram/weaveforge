/** Types for ink-undo. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { ReaderAnnotation } from "./reader-annotation.js";

export type InkUndoEntry =
  /** A stroke was created; undo removes it, redo creates it again. */
  | { kind: "create"; annotation: ReaderAnnotation }
  /** A stroke was erased; undo creates it again, redo removes it. */
  | { kind: "remove"; annotation: ReaderAnnotation }
  /** Several marks were deleted together; undo recreates all, redo removes all. */
  | { kind: "removeMany"; annotations: ReaderAnnotation[] }
  /** A mark's paths were rewritten (a stroke joined it, or it was moved). */
  | {
      kind: "anchor";
      id: string;
      before: ReaderAnnotation["anchor"];
      after: ReaderAnnotation["anchor"];
    }
  /** A mark's colour, comment, tags or text changed; each side holds the fields it set. */
  | { kind: "update"; id: string; before: InkUndoPatch; after: InkUndoPatch };

/** The fields an edit can change, as `updateLocal` takes them. */
export type InkUndoPatch = Partial<Pick<ReaderAnnotation, "color" | "comment" | "tags" | "text">>;

export interface InkUndoState {
  undo: readonly InkUndoEntry[];
  redo: readonly InkUndoEntry[];
}

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface InkUndoFns {
  readonly EMPTY_INK_UNDO: InkUndoState;
  /** How many steps are kept. A page of handwriting is a few hundred strokes. */
  readonly INK_UNDO_LIMIT: 200;
  /** Record a step. A new step is a new branch: whatever was redoable is gone. */
  pushInkUndo(state: InkUndoState, entry: InkUndoEntry): InkUndoState;
  /** The step to undo, moved onto the redo stack; `null` when there is none. */
  takeInkUndo(state: InkUndoState): { state: InkUndoState; entry: InkUndoEntry } | null;
  /** The step to redo, moved back onto the undo stack; `null` when there is none. */
  takeInkRedo(state: InkUndoState): { state: InkUndoState; entry: InkUndoEntry } | null;
  /**
 * A row was recreated under a new id: point every step at the new one.
 *
 * Both stacks are rewritten, because an entry on either side may still name
 * the row — the create that first made it, an anchor rewrite that joined a
 * stroke to it, the removal being undone right now.
 */
  renameInkUndoId(state: InkUndoState, from: string, to: string): InkUndoState;
  /**
 * A row was rewritten outside the stack (a stroke joined it): keep the
 * snapshot every entry holds current, so recreating it after an erase brings
 * back the whole mark and not the first stroke of it.
 */
  refreshInkUndoAnnotation(state: InkUndoState, annotation: ReaderAnnotation): InkUndoState;
}
