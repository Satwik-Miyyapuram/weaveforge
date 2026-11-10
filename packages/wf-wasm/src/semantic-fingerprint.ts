/**
 * Semantic index fingerprints and passage ids (Rust `semantic_fingerprint`), re-exported from index.ts.
 * Replaces the former helpers in apps/web/src/features/search/application/semantic-index.ts.
 */
import {
  documentIdOf as rawDocumentIdOf,
  documentIdOfPath as rawDocumentIdOfPath,
  embeddableText as rawEmbeddableText,
  textHash as rawTextHash,
} from "../pkg/wf_wasm.js";

/** Fingerprint of the text a document was embedded from. It is persisted, so the format must not change. */
export function textHash(text: string): string {
  return rawTextHash(text);
}

/** The document a passage id belongs to: `note:n1#2` becomes `note:n1`. */
export function documentIdOf(passage: string): string {
  return rawDocumentIdOf(passage);
}

/** Text worth embedding for a document: title and aliases joined by `. `, then the trimmed body. */
export function embeddableText(title: string, aliases: readonly string[], body: string): string {
  return rawEmbeddableText(title, [...aliases], body);
}

/** The document id behind a workspace file name: its base name with the extension taken off. */
export function documentIdOfPath(file: string): string {
  return rawDocumentIdOfPath(file);
}
