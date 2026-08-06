/**
 * Turning text into vectors.
 *
 * A port, because the thing that satisfies it is the one part of search with a
 * real cost: a model to download, a runtime to load, and a worker to keep it
 * off the render thread. Core stays free of all of that and of any opinion
 * about which model — a local ONNX encoder, a provider's embedding endpoint,
 * and a test stub are the same shape here.
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
  embed(request: EmbedRequest): Promise<Float32Array[]>;
}

/**
 * Unit-normalize in place, so cosine similarity is a plain dot product.
 *
 * Done once at insert rather than per query: a search compares against every
 * stored vector, and normalizing there would repeat the work on every keystroke.
 */
export function normalizeVector(vector: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vector.length; i += 1) sum += vector[i]! * vector[i]!;
  const length = Math.sqrt(sum);
  // A zero vector has no direction; leaving it alone keeps it at similarity 0
  // with everything rather than producing NaN.
  if (length === 0) return vector;
  for (let i = 0; i < vector.length; i += 1) vector[i] = vector[i]! / length;
  return vector;
}
