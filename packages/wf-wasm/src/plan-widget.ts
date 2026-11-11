/**
 * Plan desktop widget rules (Rust `plan_widget`), re-exported from index.ts. The types mirror the
 * Rust structs (bindings.ts).
 */
import {
  parsePlanWidgetBounds as rawParsePlanWidgetBounds,
} from "../pkg/wf_wasm.js";
import type { PlanWidgetBounds } from "./bindings.js";

export {
  cleanWidgetPalette,
  placePlanWidget,
} from "../pkg/wf_wasm.js";

export {
  parseTaskbarCreatedId,
} from "../pkg/wf_wasm.js";

export type { PlanWidgetBounds, PlanWidgetWorkArea } from "./bindings.js";

/** The widget's colours and shape, by CSS variable name. (Narrowing: pure TS Record alias; no Rust struct.) */
export type PlanWidgetPalette = Record<string, string>;

/** The saved position from the preference JSON, or null. A non-string reads as null. */
export function parsePlanWidgetBounds(stored: unknown): PlanWidgetBounds | null {
  if (typeof stored !== "string") return null;
  return rawParsePlanWidgetBounds(stored) as PlanWidgetBounds | null;
}

