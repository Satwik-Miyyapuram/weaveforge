/**
 * Lexical concept extraction (Rust `ai::lexical_concepts`), re-exported from index.ts.
 * Types come from bindings.ts.
 */
import { extractLexical as rawExtractLexical } from "../pkg/wf_wasm.js";
import type { ExtractionResult, LexicalRequest } from "./bindings.js";

/** Concepts named by capitalisation, hashtags and wikilinks across the documents. */
export function extractLexical(request: LexicalRequest): ExtractionResult {
  return rawExtractLexical(request) as ExtractionResult;
}
