/**
 * Brute-force vector index (Rust `search::vector_index`). The index itself is the
 * raw wasm `VectorIndex` class; these factories build one. Wrapper modules declare
 * no types of their own.
 */
export {
  createVectorIndex,
  vectorIndexFromBytes,
} from "../pkg/wf_wasm.js";
