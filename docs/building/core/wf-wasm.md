# Wasm crate (`wf-wasm`)

`crates/wf-wasm` compiles [`wf-core`](wf-core.md) to WebAssembly for the browser and Node, through `wasm-bindgen`. Every export is a thin wrapper: the logic lives in `wf-core` (`crates/wf-wasm/src/lib.rs` says so).

- Modules: 411 private `mod` in `src/lib.rs`, each exporting one area's functions.
- Crate type: `cdylib` and `rlib`.
- Dependencies: `wf-core`, `wasm-bindgen`, `serde`, `serde_json`, `indexmap`, `serde-wasm-bindgen`, `js-sys`.
- Build: `npm run build:wasm` (`scripts/build-wasm.mjs`) writes the module and JS glue to `packages/wf-wasm/pkg/`. `npm run wasm:fresh`, `wasm:budget` and `wasm:pkg` check it.
- Types: `packages/wf-wasm/src/index.ts` gives each raw export its type, from the bindings [`wf-bindings`](wf-bindings.md) writes.
- The app loads it with `readyCore()` and `typedCore()` in `apps/web/src/lib/rust-core.ts`.
- `unsafe_code` is `deny`, not `forbid`: the `wasm_bindgen` macro expands to `unsafe` glue under its own `#[allow]`.

Source: `crates/wf-wasm/src/`
