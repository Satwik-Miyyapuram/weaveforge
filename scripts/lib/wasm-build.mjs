/**
 * Pure helpers for `scripts/build-wasm.mjs`: read the locked wasm-bindgen version
 * and the version the CLI reports. Kept free of I/O so the tests can pin them.
 */

/** Repo-relative directory the wasm-bindgen glue and .d.ts are written to (git-ignored; `npm run generate` builds it). */
export const WASM_PKG_DIR = "packages/wf-wasm/pkg";

/** Path, under the cargo target directory, of the built module that wasm-bindgen consumes. */
export const WASM_ARTIFACT = "wasm32-unknown-unknown/wasm-release/wf_wasm.wasm";

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
