/**
 * Embedding-encoder start plan (Rust `embedding_models`). Decides whether stored
 * vectors are reused, swapped for a known encoder, or rebuilt.
 */
import { planEmbeddingStart as rawPlanEmbeddingStart } from "../pkg/wf_wasm.js";

/** `reuse` (same encoder), `swap` (known other encoder), or `rebuild` (nothing usable stored). */
export function planEmbeddingStart(
  storedModel: string | null,
  target: string,
): "reuse" | "swap" | "rebuild" {
  return rawPlanEmbeddingStart(storedModel ?? undefined, target) as "reuse" | "swap" | "rebuild";
}
