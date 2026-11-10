/**
 * Ink page undo log wrappers (DA-113), re-exported from index.ts. The types
 * come from bindings.ts; the functions are the Rust `ink_page_history` exports.
 */
import {
  pushFigureStep as rawPushFigureStep,
} from "../pkg/wf_wasm.js";
import type {
  FigurePlacement,
  PageDirection,
  PageHistory,
  TakenPageStep,
} from "./bindings.js";

export {
  emptyPageHistory,
  syncStrokeSteps,
  takePageStep,
} from "../pkg/wf_wasm.js";

export type { FigureStep, PageDirection, PageHistory, PageStep, TakenPageStep } from "./bindings.js";

/** Records a figure edit, joining the last step when `key` matches (Rust `push_figure_step`). */
export function pushFigureStep(
  history: PageHistory,
  before: readonly FigurePlacement[],
  after: readonly FigurePlacement[],
  key: number | null,
): PageHistory {
  return rawPushFigureStep(history, before, after, key) as PageHistory;
}

