# Bindings crate (`wf-bindings`)

`crates/wf-bindings` writes the TypeScript types for every Rust type that crosses into the UI, to `packages/wf-wasm/src/bindings.ts` (`OUTPUT` in `src/lib.rs`). That file is generated and gitignored, so it is absent from a fresh checkout until you run the command below.

- Run: `npm run bindings` (`cargo run -p wf-bindings --locked`).
- Dependencies: [`wf-core`](wf-core.md) with feature `specta`, `specta`, `specta-serde`, `specta-typescript`, `thiserror`.
- Files: `src/lib.rs` (rendering with `render`, `write`, tests) and `src/main.rs` (the command).

The desktop shell's command types are separate: `tauri-specta` in [`apps/shell`](shell.md) writes `apps/shell/bridge/bindings.ts`.

Source: `crates/wf-bindings/src/`
