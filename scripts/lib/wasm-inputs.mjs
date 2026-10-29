/**
 * Reads the WASM build inputs (`WASM_INPUTS` in `wasm-build.mjs`) from disk, for
 * the input stamp. The only I/O half of the WASM build helpers.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { WASM_INPUTS } from "./wasm-build.mjs";

const SKIP_DIRS = new Set(["target", "node_modules"]);

/** Push every file under `absDir` (repo-relative `rel`) onto `out`, skipping build dirs. */
function walk(absDir, rel, out) {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const childRel = `${rel}/${entry.name}`;
    const childAbs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(childAbs, childRel, out);
    } else if (entry.isFile()) {
      out.push({ path: childRel, text: readFileSync(childAbs, "utf8") });
    }
  }
}

/**
 * Every file under `WASM_INPUTS`, read as UTF-8.
 * @param {string} repoRoot absolute path of the checkout
 * @returns {Array<{ path: string, text: string }>} repo-relative paths with "/" separators
 * @throws {Error} when a listed input does not exist
 */
export function collectInputs(repoRoot) {
  const out = [];
  for (const rel of WASM_INPUTS) {
    const abs = path.join(repoRoot, rel);
    if (!existsSync(abs)) throw new Error(`missing WASM input: ${rel}`);
    if (statSync(abs).isDirectory()) walk(abs, rel, out);
    else out.push({ path: rel, text: readFileSync(abs, "utf8") });
  }
  return out;
}
