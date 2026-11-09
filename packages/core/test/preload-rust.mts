/**
 * Loaded with `--import` before every core test file (package.json "test"),
 * so code that calls `rust()` finds the real Rust core, not a stub.
 * `.mts` for top-level await.
 */
import { readFileSync } from "node:fs";
import * as core from "../../wf-wasm/src/index.ts";
import { setRustCore } from "../src/shared/rust.ts";

core.initSync({ module: readFileSync(new URL("../../wf-wasm/pkg/wf_wasm_bg.wasm", import.meta.url)) });
setRustCore(core as never);
