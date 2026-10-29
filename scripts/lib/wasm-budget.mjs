/**
 * Pure helpers for `scripts/check-wasm-budget.mjs`: the gzipped size the browser
 * downloads, measured against a budget. No I/O, so the tests can pin them.
 */
import { gzipSync } from "node:zlib";

/**
 * Repo-relative paths the browser downloads: the module and the wasm-bindgen
 * JS glue, which grows with every export. The budget is their summed gzip size.
 */
export const WASM_BUDGET_FILES = ["packages/wf-wasm/pkg/wf_wasm_bg.wasm", "packages/wf-wasm/pkg/wf_wasm.js"];

// Today the sum is 12,676 bytes (P0.3c: module 10,889 + glue 1,787, coreInfo
// only, name and producers sections removed), so 14 KB leaves about 13%
// headroom. Lower it when the size drops; raising it needs a note here saying
// which crate or feature made it grow.
export const WASM_GZIP_BUDGET = 14 * 1024;

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
 * @param {number} budget the budget in bytes
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
