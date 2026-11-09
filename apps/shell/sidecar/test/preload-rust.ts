/**
 * Loaded with `--import` before the sidecar tests (root package.json "test:sidecar"),
 * so code that calls `rust()` finds the real Rust core. Same registration as
 * packages/core/test/preload-rust.mts; main.ts does it at startup.
 * A `.ts` file so it loads as CommonJS like the tests and shares their core instance.
 */
import { readFileSync } from "node:fs";
import { setRustCore } from "@weaveforge/core";
import * as core from "@weaveforge/wasm";

core.initSync({ module: readFileSync(new URL("../../../../packages/wf-wasm/pkg/wf_wasm_bg.wasm", import.meta.url)) });
setRustCore(core as never);
