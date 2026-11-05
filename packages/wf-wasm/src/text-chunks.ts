/**
 * Splitting a document into passages an encoder can read (Rust `text_chunks`), re-exported from index.ts.
 * Keeps the signature of packages/core/src/search/text-chunks.ts.
 */
import { chunkForEmbedding as rawChunkForEmbedding } from "../pkg/wf_wasm.js";
import type { ChunkOptions, TextChunk } from "./bindings.js";

export function chunkForEmbedding(text: string, options: ChunkOptions = {}): TextChunk[] {
  return rawChunkForEmbedding(text, options) as TextChunk[];
}
