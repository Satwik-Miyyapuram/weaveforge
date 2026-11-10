/**
 * Blank-document check for model concept extraction (Rust `ai::document_text`),
 * re-exported from index.ts.
 */
import { hasText as rawHasText } from "../pkg/wf_wasm.js";

/** True when the document has text other than whitespace. A missing text is blank. */
export function hasText(text: string | null | undefined): boolean {
  return rawHasText(text ?? undefined);
}
