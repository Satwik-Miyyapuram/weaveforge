/**
 * One undo order for a page's strokes and its figures (design D18, DA-113).
 *
 * The worker keeps the stroke history and undoes strokes itself; figures live
 * in the text layer, on the main thread. This log only says whose turn each
 * undo is: a "stroke" step is handed to the worker, a figure step carries the
 * page's figures before and after and is put back by the host.
 */

import type { FigureGeometry } from "@weaveforge/core";

export interface FigureStep {
  before: readonly FigureGeometry[];
  after: readonly FigureGeometry[];
  /** The pointer press that made it; changes in one press are one step. */
  key: number | null;
}

export type PageStep = "stroke" | FigureStep;

export interface PageHistory {
  undo: readonly PageStep[];
  redo: readonly PageStep[];
}

export const EMPTY_PAGE_HISTORY: PageHistory = { undo: [], redo: [] };

const strokeCount = (steps: readonly PageStep[]) => steps.filter((s) => s === "stroke").length;

/**
 * The worker reported how deep its stroke history is. Deeper than the log
 * knows means new strokes (a new branch, so redo is gone); shallower means the
 * worker forgot some (a page load), so the newest stroke steps go.
 */
export function syncStrokeSteps(history: PageHistory, depth: number): PageHistory {
  const known = strokeCount(history.undo);
  if (depth === known) return history;
  if (depth > known) {
    return { undo: [...history.undo, ...Array<PageStep>(depth - known).fill("stroke")], redo: [] };
  }
  let drop = known - depth;
  const undo = [...history.undo];
  for (let i = undo.length - 1; i >= 0 && drop > 0; i--) {
    if (undo[i] === "stroke") {
      undo.splice(i, 1);
      drop--;
    }
  }
  return { undo, redo: history.redo };
}

/** The page's figures changed. A change in the same press as the last step joins it. */
export function pushFigureStep(
  history: PageHistory,
  before: readonly FigureGeometry[],
  after: readonly FigureGeometry[],
  key: number | null,
): PageHistory {
  if (JSON.stringify(before) === JSON.stringify(after)) return history;
  const last = history.undo[history.undo.length - 1];
  if (key !== null && last && last !== "stroke" && last.key === key) {
    return { undo: [...history.undo.slice(0, -1), { ...last, after }], redo: [] };
  }
  return { undo: [...history.undo, { before, after, key }], redo: [] };
}

/** The step to undo or redo, moved to the other stack; `null` when there is none. */
export function takePageStep(
  history: PageHistory,
  direction: "undo" | "redo",
): { history: PageHistory; step: PageStep } | null {
  const from = direction === "undo" ? history.undo : history.redo;
  const step = from[from.length - 1];
  if (!step) return null;
  const rest = from.slice(0, -1);
  return direction === "undo"
    ? { history: { undo: rest, redo: [...history.redo, step] }, step }
    : { history: { undo: [...history.undo, step], redo: rest }, step };
}
