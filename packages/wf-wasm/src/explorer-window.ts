/**
 * Which explorer rows are painted (Rust `editor_workspace::explorer_window`),
 * re-exported from index.ts. The row constants are passed in as `metrics`.
 */
import type {
  ExplorerViewport,
  RowMetrics,
  RowSlot,
} from "./bindings.js";

export {
  rowSlots,
} from "../pkg/wf_wasm.js";

export type { ExplorerViewport, RowMetrics, RowSlot } from "./bindings.js";

