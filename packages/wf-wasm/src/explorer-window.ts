/**
 * Which explorer rows are painted (Rust `editor_workspace::explorer_window`),
 * re-exported from index.ts. The row constants are passed in as `metrics`.
 */
import { rowSlots as rawRowSlots } from "../pkg/wf_wasm.js";
import type { ExplorerViewport, RowMetrics, RowSlot } from "./bindings.js";

export type { ExplorerViewport, RowMetrics, RowSlot } from "./bindings.js";

/** The painted rows and gaps for one section, in order. */
export function rowSlots(
  count: number,
  viewport: ExplorerViewport | null,
  pinned: readonly number[],
  metrics: RowMetrics,
): RowSlot[] {
  return rawRowSlots(count, viewport, pinned, metrics) as RowSlot[];
}
