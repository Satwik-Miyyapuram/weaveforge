/**
 * Brute-force vector index (Rust `search::vector_index`). The index itself is the
 * raw wasm `VectorIndex` class; these factories build one. Wrapper modules declare
 * no types of their own.
 */
import {
  createVectorIndex as rawCreateVectorIndex,
  vectorIndexFromBytes as rawVectorIndexFromBytes,
} from "../pkg/wf_wasm.js";

/** An empty index `dimensions` wide. Throws when `dimensions` is zero. */
export function createVectorIndex(dimensions: number): ReturnType<typeof rawCreateVectorIndex> {
  return rawCreateVectorIndex(dimensions);
}

/** Rebuild an index from `index.toBytes()` output. Throws on malformed bytes. */
export function vectorIndexFromBytes(
  bytes: Uint8Array,
): ReturnType<typeof rawVectorIndexFromBytes> {
  return rawVectorIndexFromBytes(bytes);
}
