/**
 * Pure helpers for `scripts/build-wasm.mjs`: read the locked wasm-bindgen version
 * and the version the CLI reports. Kept free of I/O so the tests can pin them.
 */
import { createHash } from "node:crypto";

/** Repo-relative directory the wasm-bindgen glue and .d.ts are written to (committed; see WASM_STAMP_FILE). */
export const WASM_PKG_DIR = "packages/wf-wasm/pkg";

/** Repo-relative path of the cargo-built module that wasm-bindgen consumes. */
export const WASM_ARTIFACT = "target/wasm32-unknown-unknown/wasm-release/wf_wasm.wasm";

/** Repo-relative path of the digest of WASM_INPUTS that the committed pkg was built from. */
export const WASM_STAMP_FILE = "packages/wf-wasm/pkg/inputs.sha256";

/**
 * Repo-relative files and directories whose contents decide the built module;
 * a directory means every file under it.
 */
export const WASM_INPUTS = [
  "Cargo.toml",
  "Cargo.lock",
  "rust-toolchain.toml",
  "crates",
  "scripts/build-wasm.mjs",
  "scripts/lib/wasm-build.mjs",
];

/**
 * SHA-256 over repo-relative input files. CRLF is normalised so a Windows checkout
 * and Linux CI agree; paths are sorted so the order of `files` does not matter.
 * @param {Array<{ path: string, text: string }>} files
 * @returns {string} lowercase hex digest
 */
export function inputDigest(files) {
  const hash = createHash("sha256");
  const sorted = files
    .map((f) => ({ path: f.path.replace(/\\/g, "/"), text: f.text.replace(/\r\n/g, "\n") }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const f of sorted) {
    hash.update(f.path);
    hash.update("\0");
    hash.update(f.text);
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * Cargo flags that keep the builder's home and checkout paths out of panic
 * locations in the shipped module.
 * @param {string} cargoHome the cargo home directory, e.g. CARGO_HOME
 * @param {string} repoRoot absolute path of the checkout
 * @returns {string[]} `--remap-path-prefix` flags
 */
export function remapFlags(cargoHome, repoRoot) {
  return [`--remap-path-prefix=${cargoHome}=/cargo`, `--remap-path-prefix=${repoRoot}=/weaveforge`];
}

/**
 * Version of `crate` in a Cargo.lock text, matching the name exactly.
 * @param {string} lockText contents of Cargo.lock
 * @param {string} crate package name, e.g. "wasm-bindgen"
 * @returns {string | null} the version, or null when the crate is not locked
 */
export function lockedVersion(lockText, crate) {
  for (const block of lockText.split(/\r?\n\[\[package\]\]\r?\n/)) {
    const name = block.match(/^name = "([^"]+)"/m);
    if (name && name[1] === crate) {
      const version = block.match(/^version = "([^"]+)"/m);
      return version ? version[1] : null;
    }
  }
  return null;
}

/**
 * Version from the output of `wasm-bindgen --version`.
 * @param {string} output stdout of the CLI, e.g. "wasm-bindgen 0.2.129\n"
 * @returns {string | null} the version, or null when the output has none
 */
export function cliVersion(output) {
  const m = output.match(/^wasm-bindgen (\S+)/m);
  return m ? m[1] : null;
}
