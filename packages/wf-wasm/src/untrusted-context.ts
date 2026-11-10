/**
 * Untrusted-context fencing (Rust `ai::untrusted_context`), re-exported from index.ts. Each
 * function keeps the signature of the removed TS untrusted-context module. `contextNonce`
 * lives in core-extra.ts.
 */
import {
  fenceUntrusted as rawFenceUntrusted,
} from "../pkg/wf_wasm.js";
import type {
  UntrustedItem,
} from "./bindings.js";

export {
  neutraliseContext,
  safeLabel,
  untrustedContextRule,
} from "../pkg/wf_wasm.js";

/** Fence the items into one block for a user turn. */
export function fenceUntrusted(items: readonly UntrustedItem[], nonce: string): string {
  return rawFenceUntrusted(items, nonce);
}
