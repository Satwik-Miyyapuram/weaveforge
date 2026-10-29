/**
 * Run after `npm run build:wasm`: fails when the rebuilt packages/wf-wasm/pkg
 * differs from the committed one. CI and pre-push both run it.
 *
 * Glue, types and stamp must match exactly, and no new file may appear. The
 * committed module is the Linux build (CI), and only a Linux host compares it:
 * rustc on Windows can emit different code for the same inputs, so a Windows
 * rebuild is not expected to match. To refresh the module from Windows, take
 * `wf_wasm_bg.wasm` from the `wf-wasm-pkg` artifact of a failed CI run.
 *
 *     npm run build:wasm && npm run wasm:pkg
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sameModule } from "./lib/wasm-build.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKG = "packages/wf-wasm/pkg";
const MODULE = `${PKG}/wf_wasm_bg.wasm`;
const git = (args, encoding = "utf8") => execFileSync("git", args, { cwd: repoRoot, encoding, maxBuffer: 64 << 20 });
const fix = "Run npm run build:wasm and commit packages/wf-wasm/pkg (the module from a Linux build).";

const changed = git(["status", "--porcelain", "--", PKG, `:(exclude)${MODULE}`]).trim();
if (changed) {
  console.error(`FAIL: the rebuilt WASM package differs from the committed one:\n${changed}\n${fix}`);
  process.exit(1);
}

if (process.platform !== "linux") {
  console.log(`Glue, types and stamp match; ${MODULE} is compared on Linux only (CI).`);
  process.exit(0);
}

const committed = git(["show", `HEAD:${MODULE}`], "buffer");
const rebuilt = readFileSync(path.join(repoRoot, MODULE));
if (!sameModule(committed, rebuilt)) {
  console.error(`FAIL: ${MODULE} differs from a fresh build (${committed.length} B committed, ${rebuilt.length} B built). ${fix}`);
  process.exit(1);
}

console.log("WASM package matches a fresh build");
