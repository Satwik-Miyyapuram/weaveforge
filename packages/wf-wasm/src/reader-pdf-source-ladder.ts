/**
 * PDF source ladder order (Rust `reader::pdf_source_ladder`), re-exported from index.ts.
 */
import { ladderOrder as rawLadderOrder } from "../pkg/wf_wasm.js";

/**
 * Indices of the resolvers in the order they should be tried: the ones that support the paper
 * first, in their original order.
 */
export function ladderOrder(supports: readonly boolean[]): number[] {
  return rawLadderOrder(supports) as number[];
}
