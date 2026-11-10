/**
 * Plan desktop widget rules (Rust `plan_widget`), re-exported from index.ts. The types mirror the
 * Rust structs (bindings.ts).
 */
import {
  cleanWidgetPalette as rawCleanWidgetPalette,
  parsePlanWidgetBounds as rawParsePlanWidgetBounds,
  parseTaskbarCreatedId as rawParseTaskbarCreatedId,
  placePlanWidget as rawPlacePlanWidget,
} from "../pkg/wf_wasm.js";
import type { PlanWidgetBounds, PlanWidgetWorkArea } from "./bindings.js";

export type { PlanWidgetBounds, PlanWidgetWorkArea } from "./bindings.js";

/** The widget's colours and shape, by CSS variable name. (Narrowing: pure TS Record alias; no Rust struct.) */
export type PlanWidgetPalette = Record<string, string>;

/** A palette from the app if every key is valid, else null. */
export function cleanWidgetPalette(value: unknown): PlanWidgetPalette | null {
  return rawCleanWidgetPalette(value) as PlanWidgetPalette | null;
}

/** The saved position from the preference JSON, or null. A non-string reads as null. */
export function parsePlanWidgetBounds(stored: unknown): PlanWidgetBounds | null {
  if (typeof stored !== "string") return null;
  return rawParsePlanWidgetBounds(stored) as PlanWidgetBounds | null;
}

/** The saved spot if it is on a screen, else the top-right corner of the first screen. */
export function placePlanWidget(
  saved: PlanWidgetBounds | null,
  areas: readonly PlanWidgetWorkArea[],
): PlanWidgetBounds {
  return rawPlacePlanWidget(saved, areas) as PlanWidgetBounds;
}

/** The `TaskbarCreated` message id the helper printed, or null. */
export function parseTaskbarCreatedId(stdout: string): number | null {
  return rawParseTaskbarCreatedId(stdout) as number | null;
}
