/**
 * WASM size budget (plan §4.5). Runs after `npm run build:wasm`; reads its output.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WASM_BUDGET_FILES, WASM_GZIP_BUDGET, checkWasmBudget, gzipSize } from "./lib/wasm-budget.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let total = 0;
for (const rel of WASM_BUDGET_FILES) {
  const file = path.join(repoRoot, rel);
  if (!existsSync(file)) {
    console.error(`FAIL: ${rel} not found. Run npm run build:wasm first.`);
    process.exit(1);
  }
  total += gzipSize(readFileSync(file));
}

const { ok, message } = checkWasmBudget(total, WASM_GZIP_BUDGET);
if (ok) {
  console.log(message);
  process.exit(0);
}
console.error(message);
process.exit(1);
