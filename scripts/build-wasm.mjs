/**
 * Builds crates/wf-wasm for the browser and Node: cargo compiles it to
 * wasm32 with the size-tuned `wasm-release` profile, then wasm-bindgen writes
 * the JS glue and .d.ts to packages/wf-wasm/pkg (gitignored).
 *
 * The wasm-bindgen CLI must be the exact version of the wasm-bindgen crate in
 * Cargo.lock, or the glue and the module disagree at runtime; this checks
 * before building.
 *
 *     npm run build:wasm
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WASM_ARTIFACT, WASM_PKG_DIR, cliVersion, lockedVersion } from "./lib/wasm-build.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args, stdio) => spawnSync(cmd, args, { cwd: repoRoot, stdio, encoding: "utf8" });

const want = lockedVersion(readFileSync(path.join(repoRoot, "Cargo.lock"), "utf8"), "wasm-bindgen");
if (want === null) {
  console.error("FAIL: wasm-bindgen is not in Cargo.lock.");
  process.exit(1);
}

const probe = run("wasm-bindgen", ["--version"], ["ignore", "pipe", "ignore"]);
const got = probe.error || probe.status !== 0 ? null : cliVersion(probe.stdout);
if (got !== want) {
  console.error(
    `FAIL: need wasm-bindgen CLI ${want} (found ${got ?? "none"}). Install: cargo install --locked wasm-bindgen-cli --version =${want}`,
  );
  process.exit(1);
}

const cargo = run(
  "cargo",
  ["build", "-p", "wf-wasm", "--target", "wasm32-unknown-unknown", "--profile", "wasm-release", "--locked"],
  "inherit",
);
if (cargo.error || cargo.status !== 0) {
  console.error("FAIL: cargo build of wf-wasm failed.");
  process.exit(1);
}

const bindgen = run("wasm-bindgen", [WASM_ARTIFACT, "--target", "web", "--out-dir", WASM_PKG_DIR], "inherit");
if (bindgen.error || bindgen.status !== 0) {
  console.error("FAIL: wasm-bindgen failed.");
  process.exit(1);
}

console.log(`OK: built ${WASM_PKG_DIR} (wasm-bindgen ${want})`);
