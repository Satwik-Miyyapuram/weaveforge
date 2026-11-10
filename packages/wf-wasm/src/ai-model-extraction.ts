/**
 * Model concept-extraction request building and result merging (Rust `ai::model_extraction`),
 * re-exported from index.ts. The host keeps the batch loop and the model call. Types come
 * from bindings.ts.
 */
import {
  modelBuildBatchRequest as rawBuildBatchRequest,
  modelExtractionLimits as rawExtractionLimits,
  modelFinalizeExtraction as rawFinalizeExtraction,
} from "../pkg/wf_wasm.js";
import type {
  ExtractionResult,
  ModelDocument,
  ModelExtractionLimits,
  ModelRequest,
} from "./bindings.js";

/** Default batch size, document character cap and known-concept cap. */
export function modelExtractionLimits(): ModelExtractionLimits {
  return rawExtractionLimits() as ModelExtractionLimits;
}

/** The chat request for one batch of documents. */
export function modelBuildBatchRequest(
  batch: readonly ModelDocument[],
  existing: readonly string[],
  model: string | undefined,
  maxChars: number,
  nonce: string,
): ModelRequest {
  return rawBuildBatchRequest(batch, [...existing], model, maxChars, nonce) as ModelRequest;
}

/** Merges batch results, drops concepts already in the wiki, then caps the concepts. */
export function modelFinalizeExtraction(
  results: readonly ExtractionResult[],
  existing: readonly string[],
  maxConcepts: number | null | undefined,
): ExtractionResult {
  return rawFinalizeExtraction(results, [...existing], maxConcepts ?? undefined) as ExtractionResult;
}
