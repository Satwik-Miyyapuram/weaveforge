/**
 * Page-background file tests (Rust `ink::page_background`), re-exported from index.ts.
 */
import {
  inkIsPageSource as rawInkIsPageSource,
  inkIsPdf as rawInkIsPdf,
} from "../pkg/wf_wasm.js";

/** Whether a file is a PDF, by its MIME type or a `.pdf` name in any case (Rust `is_pdf`). */
export function inkIsPdf(mime: string, name: string): boolean {
  return rawInkIsPdf(mime, name);
}

/** Whether a file can be a page background: a PDF or any image (Rust `is_page_source`). */
export function inkIsPageSource(mime: string, name: string): boolean {
  return rawInkIsPageSource(mime, name);
}
