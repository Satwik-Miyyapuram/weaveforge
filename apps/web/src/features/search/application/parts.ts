// --- embedder ---
/**
 * Turning text into vectors.
 *
 * A port, because the thing that satisfies it is the one part of search with a
 * real cost: a model to download, a runtime to load, and a worker to keep it
 * off the render thread. The app stays free of any opinion about which model:
 * a local ONNX encoder, a provider's embedding endpoint, and a test stub are the
 * same shape here. Moved from @weaveforge/core, where vector normalization now
 * lives in Rust (`search::embedding::normalize_vector`).
 */
export interface EmbedRequest {
  texts: readonly string[];
  /** Encoders often prefix queries differently from passages. */
  kind: "passage" | "query";
  signal?: AbortSignal;
}

export interface IEmbedder {
  /** Stable identifier; a change means every stored vector is stale. */
  readonly id: string;
  /** Vector width. Mixing widths in one index is meaningless, so it is checked. */
  readonly dimensions: number;
  /**
   * Cosine below which a hit is noise for this model. Scales differ by model
   * (MiniLM's unrelated pairs sit near 0.2, BGE's near 0.5), so a caller's
   * floor is only meaningful per encoder. Absent: the caller's default.
   */
  readonly minScore?: number;
  embed(request: EmbedRequest): Promise<Float32Array[]>;
}

// --- semantic-events ---
/**
 * Fired when the semantic arm attaches or detaches, so open views can re-query.
 * Its own module so a view can listen without loading the engine that fires it.
 */
export const SEMANTIC_CHANGED_EVENT = "weaveforge:semantic-changed";
