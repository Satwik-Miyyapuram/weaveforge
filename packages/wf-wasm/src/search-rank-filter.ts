/**
 * Screen-list ranking (Rust `rank_filter`). Ranked items come first by their
 * best hit position. Items the index does not hold fall back to a substring match
 * and sort after them. An empty query keeps every item in list order.
 */
import { rankFilterOrder as rawRankFilterOrder } from "../pkg/wf_wasm.js";

/** Indices into `items`, in display order. */
export function rankFilterOrder(
  query: string,
  hitEntityIds: readonly string[],
  items: readonly { id: string; fallbackText: string }[],
): number[] {
  return rawRankFilterOrder(query, hitEntityIds, items);
}
