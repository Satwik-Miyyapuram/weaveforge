/**
 * Related-document arm helpers (Rust `search::related`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/search/related.ts.
 */
import { explainArm as rawExplainArm } from "../pkg/wf_wasm.js";
import type { RelatedArm } from "./bindings.js";

/** Below this the seed has too little neighbourhood for a walk to say anything. */
export const MIN_SEED_DEGREE_FOR_PPR = 3;

/** Human-readable reason, so a thin result set is explained rather than puzzling. */
export function explainArm(arm: RelatedArm): string {
  return rawExplainArm(arm);
}
