import { readFileSync } from "node:fs";
import { initSync } from "@weaveforge/wasm";
import { loadCore, type RustCore } from "../rust-core";

const wasm = readFileSync(new URL("../../../../../packages/wf-wasm/pkg/wf_wasm_bg.wasm", import.meta.url));

/**
 * The Rust core, initialised from the committed .wasm. Node cannot fetch the
 * module the way the browser does, so a test that reaches `loadCore()` calls
 * this first in a `before` hook; later `loadCore()` calls get the same module.
 *
 * Under tsx a static `import "@weaveforge/wasm"` and loadCore's dynamic
 * `import()` load separate copies of the glue, so both are initialised.
 */
export function loadTestCore(): Promise<RustCore> {
  initSync({ module: wasm });
  return loadCore(wasm);
}
