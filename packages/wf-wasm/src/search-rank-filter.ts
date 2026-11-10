export {
  rankFilterOrder,
} from "../pkg/wf_wasm.js";
/**
 * Screen-list ranking (Rust `rank_filter`). Ranked items come first by their
 * best hit position. Items the index does not hold fall back to a substring match
 * and sort after them. An empty query keeps every item in list order.
 */

