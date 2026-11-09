/**
 * Model concept-extraction reply parsing (Rust `ai::model_concepts`), re-exported from index.ts.
 * Keeps the signatures of packages/core/src/features/ai-assistant/domain/model-concept-extractor.ts.
 */
import {
  parseExtractionJson as rawParseExtractionJson,
  toExtractionResult as rawToExtractionResult,
} from "../pkg/wf_wasm.js";

/** The reply's `concepts` list as parsed objects, or `[]`. Generic until the Rust types carry specta bindings. */
export function parseExtractionJson<Concept>(text: string): Concept[] {
  return rawParseExtractionJson(text) as Concept[];
}

/** Concepts with ids checked against `batchIds`. Generic until the Rust types carry specta bindings. */
export function toExtractionResult<Raw, Result>(raw: readonly Raw[], batchIds: readonly string[]): Result {
  return rawToExtractionResult(raw, [...batchIds]) as Result;
}
