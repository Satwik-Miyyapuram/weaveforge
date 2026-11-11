/**
 * Note-link helpers (Rust `vault::link_resolve`), re-exported from index.ts: which existing note a
 * `[[title]]` resolves to, and the message for link targets that failed to load.
 */
export {
  findTitleMatch,
  linkTargetsError,
} from "../pkg/wf_wasm.js";
