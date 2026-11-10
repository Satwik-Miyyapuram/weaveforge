/**
 * AI excerpt retrieval (Rust `ai::retrieval`), re-exported from index.ts.
 * Keeps the signature of packages/core/src/features/ai-assistant/domain/ai-retrieval.ts.
 * The raw export takes the options object whole; `{}` means the defaults.
 */
import {
  citedSourceNumbers as rawCitedSourceNumbers,
  retrieveAiExcerpts as rawRetrieveAiExcerpts,
} from "../pkg/wf_wasm.js";

/** Passages ranked by lexical score. Generic until the Rust types carry specta bindings. */
export function retrieveAiExcerpts<Document, Excerpt>(
  documents: readonly Document[],
  query: string,
  options: { limit?: number; maxChars?: number } = {},
): Excerpt[] {
  return rawRetrieveAiExcerpts(documents, query, options) as Excerpt[];
}

/** The 1-based source numbers an answer cites with `[n]` or `[n, m]`, first citation order, each once. */
export function citedSourceNumbers(answer: string, count: number): number[] {
  return rawCitedSourceNumbers(answer, count) as number[];
}
