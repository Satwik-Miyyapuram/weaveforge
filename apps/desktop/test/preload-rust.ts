/**
 * Loaded with `--import` before the desktop tests (package.json "test"),
 * so code that calls `rust()` finds the real Rust core. Same registration as
 * apps/shell/sidecar/test/preload-rust.ts.
 * A `.ts` file so it loads as CommonJS like the tests and shares their core instance.
 */
import { readFileSync } from "node:fs";
import { setRustCore } from "@weaveforge/core";
import * as core from "@weaveforge/wasm";
import { registerLoadedCore } from "@/lib/rust-core";

core.initSync({ module: readFileSync(new URL("../../../packages/wf-wasm/pkg/wf_wasm_bg.wasm", import.meta.url)) });
setRustCore(core as never);
// Web code that runs here (safe-fetch, the Overleaf reader) reads the core through typedCore().
registerLoadedCore(core);
