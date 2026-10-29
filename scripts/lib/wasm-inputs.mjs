/**
 * Reads the WASM build inputs (`WASM_INPUTS` in `wasm-build.mjs`) from disk, for
 * the input stamp. The only I/O half of the WASM build helpers.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { WASM_INPUTS } from "./wasm-build.mjs";

/**
 * Every file git tracks under `WASM_INPUTS`, read as UTF-8 from the working
 * tree. Only tracked files count, so a scratch or backup file on one machine
 * cannot change the stamp there and not on CI.
 * @param {string} repoRoot absolute path of the checkout
 * @returns {Array<{ path: string, text: string }>} repo-relative paths with "/" separators
 * @throws {Error} when a listed input is not tracked
 */
export function collectInputs(repoRoot) {
  const out = [];
  for (const rel of WASM_INPUTS) {
    const files = execFileSync("git", ["ls-files", "-z", "--", rel], { cwd: repoRoot, encoding: "utf8" })
      .split("\0")
      .filter(Boolean);
    if (files.length === 0) throw new Error(`missing WASM input: ${rel}`);
    for (const file of files) {
      // A tracked file deleted on disk is no longer an input.
      const abs = path.join(repoRoot, file);
      if (existsSync(abs)) out.push({ path: file, text: readFileSync(abs, "utf8") });
    }
  }
  return out;
}
