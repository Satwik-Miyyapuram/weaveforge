# Bindings crate (`wf-bindings`)

`crates/wf-bindings` writes the TypeScript types for every Rust type that crosses into the UI, to `packages/wf-wasm/src/bindings.ts` (`OUTPUT` in `src/lib.rs`).

- Run: `npm run bindings` (`cargo run -p wf-bindings --locked`). With `-- --check` it fails if the file is stale.
- Dependencies: [`wf-core`](wf-core.md) with feature `specta`, `specta`, `specta-serde`, `specta-typescript`, `thiserror`.
- Files: `src/lib.rs` (rendering, `is_fresh`, `write`, tests) and `src/main.rs` (the command).

The desktop shell's command types are separate: `tauri-specta` in [`apps/shell`](shell.md) writes `apps/shell/bridge/bindings.ts`.

Source: `crates/wf-bindings/src/`
