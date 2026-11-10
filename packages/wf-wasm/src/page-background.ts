/**
 * Where a page background sits on the A4 sheet (Rust `ink::page_background`),
 * re-exported from index.ts.
 */
import type {
  Placement,
} from "./bindings.js";

export {
  placeOnSheet,
} from "../pkg/wf_wasm.js";

export type { Placement };

