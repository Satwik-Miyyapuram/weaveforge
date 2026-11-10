/**
 * The page text after handwriting is recognised, re-exported from index.ts. The
 * function is the Rust `page_text` export.
 */
import { pageTextAfterRecognition as rawPageTextAfterRecognition } from "../pkg/wf_wasm.js";

/** The page text once recognised: typed text, then recognised text (Rust `page_text_after_recognition`). */
export function pageTextAfterRecognition(was: string, prior: string, recognised: string): string {
  return rawPageTextAfterRecognition(was, prior, recognised);
}
