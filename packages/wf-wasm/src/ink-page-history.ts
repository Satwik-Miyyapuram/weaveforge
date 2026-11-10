/**
 * Ink page undo log wrappers (DA-113), re-exported from index.ts. The types
 * come from bindings.ts; the functions are the Rust `ink_page_history` exports.
 */
import {
  emptyPageHistory as rawEmptyPageHistory,
  pushFigureStep as rawPushFigureStep,
  syncStrokeSteps as rawSyncStrokeSteps,
  takePageStep as rawTakePageStep,
} from "../pkg/wf_wasm.js";
import type {
  FigurePlacement,
  PageDirection,
  PageHistory,
  TakenPageStep,
} from "./bindings.js";

export type { FigureStep, PageDirection, PageHistory, PageStep, TakenPageStep } from "./bindings.js";

/** The history of a page with nothing to undo or redo (Rust `empty_page_history`). */
export function emptyPageHistory(): PageHistory {
  return rawEmptyPageHistory() as PageHistory;
}

/** Brings the stroke steps to the worker's `depth` (Rust `sync_stroke_steps`). */
export function syncStrokeSteps(history: PageHistory, depth: number): PageHistory {
  return rawSyncStrokeSteps(history, depth) as PageHistory;
}

/** Records a figure edit, joining the last step when `key` matches (Rust `push_figure_step`). */
export function pushFigureStep(
  history: PageHistory,
  before: readonly FigurePlacement[],
  after: readonly FigurePlacement[],
  key: number | null,
): PageHistory {
  return rawPushFigureStep(history, before, after, key) as PageHistory;
}

/** Moves the next step to the other stack; `null` when there is none (Rust `take_page_step`). */
export function takePageStep(history: PageHistory, direction: PageDirection): TakenPageStep | null {
  return rawTakePageStep(history, direction) as TakenPageStep | null;
}
