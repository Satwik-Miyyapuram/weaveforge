/**
 * Vector normalization (Rust `search::embedding`), re-exported from index.ts.
 * Keeps the signature of packages/core/src/search/embedding-port.ts. Unlike that
 * file, this returns a new Float32Array and does not normalize in place.
 */
import { normalizeVector as rawNormalizeVector } from "../pkg/wf_wasm.js";

/** Unit-normalize a copy, so cosine similarity is a plain dot product. A zero vector comes back as zeros. */
export function normalizeVector(vector: Float32Array): Float32Array {
  return new Float32Array(rawNormalizeVector(vector));
}
