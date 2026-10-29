/**
 * Pins the WASM size budget. The browser downloads the gzipped module, so the
 * gate must fail exactly when that size passes the budget.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkWasmBudget, gzipSize, WASM_BUDGET_FILES, WASM_GZIP_BUDGET } from "../wasm-budget.mjs";

test("exactly at the budget is ok", () => {
  assert.equal(checkWasmBudget(WASM_GZIP_BUDGET, WASM_GZIP_BUDGET).ok, true);
});

test("one byte over the budget fails and names the constant to raise", () => {
  const result = checkWasmBudget(WASM_GZIP_BUDGET + 1, WASM_GZIP_BUDGET);
  assert.equal(result.ok, false);
  assert.match(result.message, /WASM_GZIP_BUDGET/);
});

test("under the budget reports OK", () => {
  const result = checkWasmBudget(1000, WASM_GZIP_BUDGET);
  assert.ok(result.message.startsWith("WASM budget OK"), result.message);
});

test("gzipSize compresses a zero-filled buffer", () => {
  const size = gzipSize(Buffer.alloc(100000));
  assert.ok(size > 0 && size < 100000, `got ${size}`);
});

test("the budget is a positive integer", () => {
  assert.ok(Number.isInteger(WASM_GZIP_BUDGET) && WASM_GZIP_BUDGET > 0);
});

test("the budget covers the module and its JS glue", () => {
  assert.deepEqual(
    [...WASM_BUDGET_FILES].sort(),
    ["packages/wf-wasm/pkg/wf_wasm.js", "packages/wf-wasm/pkg/wf_wasm_bg.wasm"],
  );
});
