/**
 * Ink page undo log wrappers (DA-113), re-exported from index.ts. The types
 * come from bindings.ts; the functions are the Rust `ink_page_history` exports.
 */
import type {
  PageDirection,
  PageHistory,
  TakenPageStep,
} from "./bindings.js";

export {
  pushFigureStep,
} from "../pkg/wf_wasm.js";

export {
  emptyPageHistory,
  syncStrokeSteps,
  takePageStep,
} from "../pkg/wf_wasm.js";

export type { FigureStep, PageDirection, PageHistory, PageStep, TakenPageStep } from "./bindings.js";

