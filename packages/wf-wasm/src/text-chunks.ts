/**
 * Splitting a document into passages an encoder can read (Rust `text_chunks`), re-exported from index.ts.
 * Keeps the signature of the old TS module (removed; its types now live in packages/core/src/shared/core-contract.ts).
 */
import { chunkForEmbedding as rawChunkForEmbedding } from "../pkg/wf_wasm.js";
import type { ChunkOptions, TextChunk } from "./bindings.js";

export function chunkForEmbedding(text: string, options: ChunkOptions = {}): TextChunk[] {
  return rawChunkForEmbedding(text, options) as TextChunk[];
}
