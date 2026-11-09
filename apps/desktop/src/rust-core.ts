/**
 * Registers the Rust core for this process. Shared logic in @weaveforge/core
 * calls `rust()`, so this runs before any handler: main.ts imports it first.
 * The build copies `wf_wasm_bg.wasm` next to the bundle.
 */
import fs from "node:fs";
import path from "node:path";
import { setRustCore } from "@weaveforge/core";
import * as core from "@weaveforge/wasm";
import { registerLoadedCore } from "@/lib/rust-core";

core.initSync({ module: fs.readFileSync(path.join(__dirname, "wf_wasm_bg.wasm")) });
setRustCore(core as never);
// Web code that runs here (safe-fetch, the Overleaf reader) reads the core through typedCore().
registerLoadedCore(core);
