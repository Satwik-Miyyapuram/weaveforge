export {
  fenceUntrusted,
} from "../pkg/wf_wasm.js";
/**
 * Untrusted-context fencing (Rust `ai::untrusted_context`), re-exported from index.ts. Each
 * function keeps the signature of the removed TS untrusted-context module. `contextNonce`
 * lives in core-extra.ts.
 */

export {
  neutraliseContext,
  safeLabel,
  untrustedContextRule,
} from "../pkg/wf_wasm.js";

