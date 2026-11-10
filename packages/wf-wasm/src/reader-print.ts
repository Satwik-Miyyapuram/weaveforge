/**
 * The reader's printable paper, re-exported from feature-wrappers.ts. The types come from
 * bindings.ts; the functions are the Rust `reader_print_document` and `reader_print_orientation`.
 */
import {
  readerPrintDocument as rawReaderPrintDocument,
  readerPrintOrientation as rawReaderPrintOrientation,
} from "../pkg/wf_wasm.js";
import type { ReaderPrintDocument, ReaderPrintLayoutInput } from "./bindings.js";

export type {
  ReaderPrintDocument,
  ReaderPrintLayoutInput,
  ReaderPrintNote,
  ReaderPrintPage,
} from "./bindings.js";

/** Landscape beside the comments, or portrait on its own (Rust `reader_print_orientation`). */
export type ReaderPrintOrientation = "portrait" | "landscape";

/** The paper as an HTML document for a print frame's `srcdoc` (Rust `reader_print_document`). */
export function readerPrintDocument(doc: ReaderPrintDocument): string {
  return rawReaderPrintDocument(doc);
}

/** The sheet's orientation for these pages (Rust `reader_print_orientation`). */
export function readerPrintOrientation(input: ReaderPrintLayoutInput): ReaderPrintOrientation {
  return rawReaderPrintOrientation(input) as ReaderPrintOrientation;
}
