/**
 * Semantic index fingerprints and passage ids (Rust `semantic_fingerprint`), re-exported from index.ts.
 * Replaces the former helpers in apps/web/src/features/search/application/semantic-index.ts.
 */
import {
  embeddableText as rawEmbeddableText,
} from "../pkg/wf_wasm.js";

export {
  documentIdOf,
  documentIdOfPath,
  textHash,
} from "../pkg/wf_wasm.js";

/** Text worth embedding for a document: title and aliases joined by `. `, then the trimmed body. */
export function embeddableText(title: string, aliases: readonly string[], body: string): string {
  return rawEmbeddableText(title, [...aliases], body);
}

