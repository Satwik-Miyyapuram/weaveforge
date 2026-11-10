/**
 * Printable ink page wrapper, re-exported from index.ts. The types come from
 * bindings.ts; the function is the Rust `ink_print` export.
 */
import { inkPrintDocument as rawInkPrintDocument } from "../pkg/wf_wasm.js";
import type { InkPrintDocument } from "./bindings.js";

export type {
  InkPrintDocument,
  InkPrintFigure,
  InkPrintPageSize,
  InkPrintStyleSheet,
  InkPrintUnderlay,
} from "./bindings.js";

/** The page as an HTML document for a print frame's `srcdoc` (Rust `ink_print_document`). */
export function inkPrintDocument(doc: InkPrintDocument): string {
  return rawInkPrintDocument(doc);
}
