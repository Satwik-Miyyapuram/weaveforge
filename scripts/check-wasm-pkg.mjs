/**
 * Run after `npm run build:wasm`: fails when the rebuilt packages/wf-wasm/pkg
 * differs from the committed one. CI and pre-push both run it.
 *
 * Glue, types and stamp must match exactly, and no new file may appear; off
 * Linux, glue and types may differ only in host-dependent crate hashes. The
 * committed module is the Linux build (CI), and only a Linux host compares it:
 * rustc on Windows can emit different code for the same inputs, so a Windows
 * rebuild is not expected to match. Off Linux, once glue, types and stamp
 * match, this script puts the committed module back over the rebuilt one, so
 * the tests and budget that follow run on the module that ships and the
 * working tree stays clean. When they do not match, the rebuilt module stays:
 * it belongs with the new glue.
 *
 * Changing the Rust from Windows takes two pushes: commit the whole rebuilt
 * pkg (its module is a Windows placeholder) and push; CI fails the module
 * compare and uploads the `wf-wasm-pkg` artifact; commit its
 * `wf_wasm_bg.wasm` and push again.
 *
 *     npm run build:wasm && npm run wasm:pkg
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sameModule } from "./lib/wasm-build.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKG = "packages/wf-wasm/pkg";
const MODULE = `${PKG}/wf_wasm_bg.wasm`;
const git = (args, encoding = "utf8") => execFileSync("git", args, { cwd: repoRoot, encoding, maxBuffer: 64 << 20 });
const fix =
  "Run npm run build:wasm and commit all of packages/wf-wasm/pkg. Off Linux the module is a placeholder: " +
  "push, then commit wf_wasm_bg.wasm from that CI run's wf-wasm-pkg artifact and push again.";

// Cargo puts the host triple into crate hashes, and wasm-bindgen writes those
// hashes into glue symbol names (`wasm_bindgen_c59c2fd73ee08fa2___…`). So glue
// built off Linux differs from the committed (Linux) glue in those hashes only.
const GLUE = new Set(["wf_wasm.js", "wf_wasm.d.ts", "wf_wasm_bg.wasm.d.ts"].map((f) => `${PKG}/${f}`));
const unhash = (text) => text.replace(/([A-Za-z0-9])_[0-9a-f]{12,16}(?=___)/g, "$1_#");
const hashOnly = (file) => unhash(git(["show", `HEAD:${file}`])) === unhash(readFileSync(path.join(repoRoot, file), "utf8"));

const changed = git(["status", "--porcelain", "--", PKG, `:(exclude)${MODULE}`]).trimEnd();
const entries = changed ? changed.split("\n").map((line) => ({ status: line.slice(0, 2), file: line.slice(3) })) : [];
const tolerated =
  process.platform !== "linux" && entries.every(({ status, file }) => status === " M" && GLUE.has(file) && hashOnly(file));
if (entries.length && !tolerated) {
  console.error(`FAIL: the rebuilt WASM package differs from the committed one:\n${changed}\n${fix}`);
  process.exit(1);
}

const committed = git(["show", `HEAD:${MODULE}`], "buffer");
if (process.platform !== "linux") {
  for (const { file } of entries) writeFileSync(path.join(repoRoot, file), git(["show", `HEAD:${file}`], "buffer"));
  if (entries.length) console.log("Glue differs only in host-dependent crate hashes; the committed glue was put back.");
  writeFileSync(path.join(repoRoot, MODULE), committed);
  console.log(`Glue, types and stamp match; ${MODULE} is compared on Linux only (CI), so the committed one was put back.`);
  process.exit(0);
}

const rebuilt = readFileSync(path.join(repoRoot, MODULE));
if (!sameModule(committed, rebuilt)) {
  console.error(`FAIL: ${MODULE} differs from a fresh build (${committed.length} B committed, ${rebuilt.length} B built). ${fix}`);
  process.exit(1);
}

console.log("WASM package matches a fresh build");
