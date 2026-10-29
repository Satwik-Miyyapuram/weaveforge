/**
 * The Rust core (crates/wf-wasm) for TypeScript.
 *
 * wasm-bindgen's raw exports return `any`. Each is re-exported here with the
 * type that crates/wf-bindings generated from the Rust struct into
 * ./bindings.ts. This file declares no types of its own, and every raw export
 * has a wrapper here; test/index.test.ts checks both.
 *
 * Call `init` (browser, fetches the .wasm) or `initSync` (bytes in hand, e.g.
 * Node) once before any other export.
 */
import init, { initSync, coreInfo as rawCoreInfo } from "../pkg/wf_wasm.js";
import type { CoreInfo } from "./bindings.js";

export type { CoreInfo };
export { init, initSync };

/** Facts about this core build, such as its version. */
export function coreInfo(): CoreInfo {
  return rawCoreInfo() as CoreInfo;
}
