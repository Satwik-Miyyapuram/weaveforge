/**
 * Printable ink page wrapper, re-exported from index.ts. The types come from
 * bindings.ts; the function is the Rust `ink_print` export.
 */
import type {
  InkPrintDocument,
} from "./bindings.js";

export {
  inkPrintDocument,
} from "../pkg/wf_wasm.js";

export type {
  InkPrintDocument,
  InkPrintFigure,
  InkPrintPageSize,
  InkPrintStyleSheet,
  InkPrintUnderlay,
} from "./bindings.js";

