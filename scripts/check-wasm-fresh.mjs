/**
 * Fails when the committed packages/wf-wasm/pkg was not built from the current
 * Rust inputs: the digest of WASM_INPUTS must equal the stamp that
 * build-wasm.mjs wrote next to the module.
 *
 *     npm run wasm:fresh
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WASM_STAMP_FILE, inputDigest } from "./lib/wasm-build.mjs";
import { collectInputs } from "./lib/wasm-inputs.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const stampPath = path.join(repoRoot, WASM_STAMP_FILE);
const fix =
  "Run npm run build:wasm and commit all of packages/wf-wasm/pkg. Off Linux the module is a placeholder: " +
  "push, then commit wf_wasm_bg.wasm from that CI run's wf-wasm-pkg artifact and push again.";

if (!existsSync(stampPath)) {
  console.error(`FAIL: ${WASM_STAMP_FILE} not found. ${fix}`);
  process.exit(1);
}

const want = inputDigest(collectInputs(repoRoot));
const got = readFileSync(stampPath, "utf8").trim();
if (got !== want) {
  console.error(`FAIL: packages/wf-wasm/pkg is stale (stamp ${got.slice(0, 12)}, inputs ${want.slice(0, 12)}). ${fix}`);
  process.exit(1);
}

console.log(`WASM package fresh (inputs ${want.slice(0, 12)})`);
