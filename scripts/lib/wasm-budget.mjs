/**
 * Pure helpers for `scripts/check-wasm-budget.mjs`: the gzipped size the browser
 * downloads, measured against a ratchet. No I/O, so the tests can pin them.
 */
import { gzipSync } from "node:zlib";

/** Repo-relative path of the wasm-bindgen module the budget measures. */
export const WASM_BUDGET_FILE = "packages/wf-wasm/pkg/wf_wasm_bg.wasm";

// The gzipped size the browser downloads — a ratchet. Today it is 14,292 bytes
// (P0.3, coreInfo only). It may come down freely; raising it needs a note here
// saying which crate or feature made it grow.
export const WASM_GZIP_BUDGET = 20 * 1024;

/**
 * Gzipped byte length of a module, with zlib's default options.
 * @param {Uint8Array} bytes the raw module
 * @returns {number} compressed length in bytes
 */
export function gzipSize(bytes) {
  return gzipSync(bytes).length;
}

/**
 * Compare a gzipped size with the budget and describe the result.
 * @param {number} gzipBytes measured gzipped size
 * @param {number} budget the ratchet in bytes
 * @returns {{ ok: boolean, message: string }}
 */
export function checkWasmBudget(gzipBytes, budget) {
  if (gzipBytes <= budget) {
    return { ok: true, message: `WASM budget OK: ${kb(gzipBytes)} gzipped (budget ${kb(budget)})` };
  }
  return {
    ok: false,
    message:
      `WASM budget FAIL: ${kb(gzipBytes)} gzipped is over the ${kb(budget)} budget. ` +
      "Shrink it, or raise WASM_GZIP_BUDGET in scripts/lib/wasm-budget.mjs with a note saying what grew.",
  };
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
