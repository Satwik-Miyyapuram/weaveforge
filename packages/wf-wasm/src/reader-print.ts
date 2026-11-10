/**
 * The reader's printable paper, re-exported from feature-wrappers.ts. The types come from
 * bindings.ts; the functions are the Rust `reader_print_document` and `reader_print_orientation`.
 */
import type {
  ReaderPrintDocument,
  ReaderPrintLayoutInput,
} from "./bindings.js";

export {
  readerPrintDocument,
  readerPrintOrientation,
} from "../pkg/wf_wasm.js";

export type {
  ReaderPrintDocument,
  ReaderPrintLayoutInput,
  ReaderPrintNote,
  ReaderPrintPage,
} from "./bindings.js";

/** Landscape beside the comments, or portrait on its own (Rust `reader_print_orientation`). */
export type ReaderPrintOrientation = "portrait" | "landscape";

