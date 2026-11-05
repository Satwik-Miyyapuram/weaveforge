import { readFileSync } from "node:fs";
import { loadCore, type RustCore } from "../rust-core";

const wasm = readFileSync(new URL("../../../../../packages/wf-wasm/pkg/wf_wasm_bg.wasm", import.meta.url));

/**
 * The Rust core, initialised from the committed .wasm. Node cannot fetch the
 * module the way the browser does, so a test that reaches `loadCore()` calls
 * this first in a `before` hook; later `loadCore()` calls get the same module.
 */
export function loadTestCore(): Promise<RustCore> {
  return loadCore(wasm);
}
