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

// Lower it when the size drops; raising it needs a note here saying which
// crate or feature made it grow.
// - P0.3c: 12,676 bytes (module 10,889 + glue 1,787), coreInfo only. 14 KB.
// - P1.2: 125,322 bytes (module 121,471 + glue 3,851). The tokenizer exports
//   pull in wf-core's search module and its Unicode tables: the data section
//   is 84.6 KB gzipped (NFD and NFC tables from unicode-normalization, general
//   category from unicode-properties, std lowercase), code 34.8 KB. The TS
//   got these from the JS engine for free; exact parity needs them. The .wasm
//   loads lazily, not in first-load JS. 136 KB leaves ~11% for the query,
//   fusion and excerpt exports (P1.4, P1.7).
// - P1.7b: 141,676 bytes (module 136,659 + glue 5,017), the CI Linux build.
//   buildExcerpt adds wf-core's excerpt module plus serde for its result
//   (~5 KB). 142 KB is the last search export's ceiling; P1.8 deletes TS, not WASM.
export const WASM_GZIP_BUDGET = 142 * 1024;

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
