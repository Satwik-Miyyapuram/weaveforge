/**
 * AI excerpt retrieval (Rust `ai::retrieval`), re-exported from index.ts.
 * Keeps the signature of packages/core/src/features/ai-assistant/domain/ai-retrieval.ts.
 * The raw export takes the options object whole; `{}` means the defaults.
 */
import {
  retrieveAiExcerpts as rawRetrieveAiExcerpts,
} from "../pkg/wf_wasm.js";

export {
  citedSourceNumbers,
} from "../pkg/wf_wasm.js";

/** Passages ranked by lexical score. Generic until the Rust types carry specta bindings. */
export function retrieveAiExcerpts<Document, Excerpt>(
  documents: readonly Document[],
  query: string,
  options: { limit?: number; maxChars?: number } = {},
): Excerpt[] {
  return rawRetrieveAiExcerpts(documents, query, options) as Excerpt[];
}

