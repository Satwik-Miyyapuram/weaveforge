/**
 * Undo and redo for a freeform page, as whole-file snapshots. Pure and generic,
 * so the editor decides what one snapshot is (one edit or one drag).
 */

/** Snapshots share their unchanged parts, so a long history costs little; 50 lost a page's first strokes. */
export const HISTORY_LIMIT = 1000;

export interface History<T> {
  past: readonly T[];
  present: T;
  future: readonly T[];
}

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** Makes `next` the present; the old present becomes undoable. Same snapshot: no change. */
export function record<T>(h: History<T>, next: T): History<T> {
  if (Object.is(next, h.present)) return h;
  const past = [...h.past, h.present];
  return { past: past.slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}

export function undo<T>(h: History<T>): History<T> {
  if (!canUndo(h)) return h;
  const last = h.past.length - 1;
  return { past: h.past.slice(0, last), present: h.past[last] as T, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!canRedo(h)) return h;
  const next = h.future[0] as T;
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1) };
}
