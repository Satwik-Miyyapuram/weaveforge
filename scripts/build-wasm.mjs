/**
 * Builds crates/wf-wasm for the browser and Node: cargo compiles it to
 * wasm32 with the size-tuned `wasm-release` profile, then wasm-bindgen writes
 * the JS glue and .d.ts to packages/wf-wasm/pkg, which is committed so the
 * web, desktop and mobile builds need no Rust. It also writes the digest of
 * the build inputs there (WASM_STAMP_FILE); check-wasm-fresh.mjs compares it.
 *
 * Panic locations carry source paths, so the cargo home and checkout paths are
 * remapped to keep the builder's home directory out of the shipped module.
 *
 * The wasm-bindgen CLI must be the exact version of the wasm-bindgen crate in
 * Cargo.lock, or the glue and the module disagree at runtime; this checks
 * before building.
 *
 *     npm run build:wasm
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  WASM_ARTIFACT,
  WASM_PKG_DIR,
  WASM_STAMP_FILE,
  cliVersion,
  inputDigest,
  lockedVersion,
  remapFlags,
} from "./lib/wasm-build.mjs";
import { collectInputs } from "./lib/wasm-inputs.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args, stdio, env = process.env) =>
  spawnSync(cmd, args, { cwd: repoRoot, stdio, encoding: "utf8", env });

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
  {
    ...process.env,
    // Encoded flags win over RUSTFLAGS and keep paths with spaces intact.
    CARGO_ENCODED_RUSTFLAGS: remapFlags(process.env.CARGO_HOME ?? path.join(homedir(), ".cargo"), repoRoot).join(
      "\x1f",
    ),
  },
);
if (cargo.error || cargo.status !== 0) {
  console.error("FAIL: cargo build of wf-wasm failed.");
  process.exit(1);
}

const bindgen = run(
  "wasm-bindgen",
  [
    WASM_ARTIFACT,
    "--target",
    "web",
    "--out-dir",
    WASM_PKG_DIR,
    "--remove-name-section",
    "--remove-producers-section",
  ],
  "inherit",
);
if (bindgen.error || bindgen.status !== 0) {
  console.error("FAIL: wasm-bindgen failed.");
  process.exit(1);
}

writeFileSync(path.join(repoRoot, WASM_STAMP_FILE), `${inputDigest(collectInputs(repoRoot))}\n`);

console.log(`OK: built ${WASM_PKG_DIR} (wasm-bindgen ${want})`);
