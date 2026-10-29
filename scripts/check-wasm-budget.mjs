/**
 * WASM size budget (plan §4.5). Runs after `npm run build:wasm`; reads its output.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WASM_BUDGET_FILE, WASM_GZIP_BUDGET, checkWasmBudget, gzipSize } from "./lib/wasm-budget.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(repoRoot, WASM_BUDGET_FILE);

if (!existsSync(file)) {
  console.error(`FAIL: ${WASM_BUDGET_FILE} not found. Run npm run build:wasm first.`);
  process.exit(1);
}

const { ok, message } = checkWasmBudget(gzipSize(readFileSync(file)), WASM_GZIP_BUDGET);
if (ok) {
  console.log(message);
  process.exit(0);
}
console.error(message);
process.exit(1);
