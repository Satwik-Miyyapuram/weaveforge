/** Types for text-chunks. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

/**
 * Splitting a document into passages an encoder can actually read.
 *
 * Sentence encoders truncate at a few hundred tokens. Feeding a whole note to
 * one does not fail loudly — it silently embeds the first paragraph and throws
 * the rest away, so a workspace looks indexed while most of it is not
 * searchable. Chunking is what makes the vector half honest.
 *
 * Boundaries are chosen by structure first (blank lines, then sentences, then
 * whitespace) because a passage cut mid-sentence embeds to a worse vector than
 * one that ends where a thought does.
 */

export interface TextChunk {
  text: string;
  /** Offset in the source, so a hit can point at the passage it matched. */
  start: number;
  end: number;
}

export interface ChunkOptions {
  /**
   * Characters per passage. Roughly four per token, so 1 000 sits under the
   * 256-token window the small sentence encoders use.
   */
  maxChars?: number;
  /**
   * Characters repeated between neighbours, so a sentence spanning a boundary
   * lands whole in one of them.
   */
  overlapChars?: number;
  /** Below this a trailing fragment is merged back rather than embedded alone. */
  minChars?: number;
}

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface TextChunksFns {
  /**
 * Split text into overlapping passages.
 *
 * Text short enough to fit is returned as one chunk rather than padded or
 * split — the common case for a note is a single passage, and paying for the
 * boundary search there would be waste.
 */
  chunkForEmbedding(text: string, options?: ChunkOptions): TextChunk[];
}
