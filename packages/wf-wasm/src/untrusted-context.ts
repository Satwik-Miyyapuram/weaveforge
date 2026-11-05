/**
 * Untrusted-context fencing (Rust `ai::untrusted_context`), re-exported from index.ts. Each
 * function keeps the signature of packages/core/src/features/ai-assistant/domain/
 * untrusted-context.ts, except `contextNonce`, which is not ported.
 */
import {
  fenceUntrusted as rawFenceUntrusted,
  neutraliseContext as rawNeutraliseContext,
  safeLabel as rawSafeLabel,
  untrustedContextRule as rawUntrustedContextRule,
} from "../pkg/wf_wasm.js";
import type { UntrustedItem } from "./bindings.js";

/** TS `UNTRUSTED_CONTEXT_RULE`, as a call: wasm is not ready at import time. */
export function untrustedContextRule(): string {
  return rawUntrustedContextRule();
}

/** Strip what a document could use to escape its own fence. */
export function neutraliseContext(text: string, nonce: string): string {
  return rawNeutraliseContext(text, nonce);
}

/** A one-line, length-capped label for untrusted text. */
export function safeLabel(label: string, nonce: string): string {
  return rawSafeLabel(label, nonce);
}

/** Fence the items into one block for a user turn. */
export function fenceUntrusted(items: readonly UntrustedItem[], nonce: string): string {
  return rawFenceUntrusted(items, nonce);
}
