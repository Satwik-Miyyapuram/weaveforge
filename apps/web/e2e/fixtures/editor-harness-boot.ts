/**
 * Entry for the editor harness page: loads the Rust core, then the harness.
 *
 * The editor calls the core synchronously (`readyCore()`), as the app does
 * behind its core gate, so the core has to be in before the harness module
 * runs. The page is opened from `file://`, where fetching the `.wasm` is
 * refused, so esbuild inlines its bytes (`loader: { ".wasm": "binary" }`).
 */
import wasm from "../../../../packages/wf-wasm/pkg/wf_wasm_bg.wasm";
import { loadCore } from "@/lib/rust-core";

void loadCore(wasm).then(() => import("./editor-harness"));
