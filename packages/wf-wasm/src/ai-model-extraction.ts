/**
 * Model concept-extraction request building and result merging (Rust `ai::model_extraction`),
 * re-exported from index.ts. The host keeps the batch loop and the model call. Types come
 * from bindings.ts.
 */
export {
  modelBuildBatchRequest,
  modelExtractionLimits,
  modelFinalizeExtraction,
} from "../pkg/wf_wasm.js";
