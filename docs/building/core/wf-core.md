# Core crate (`wf-core`)

`crates/wf-core` is the pure logic shared by every shell: desktop, phone, and the browser through wasm. It does no I/O (`crates/wf-core/src/lib.rs` says so). The browser reaches it through [`wf-wasm`](wf-wasm.md). `apps/shell` and `apps/relay/server` call it natively.

- Modules: 120 `pub mod` in `src/lib.rs`, one per feature area. Most have their own page in this folder; see the [index](README.md).
- Dependencies: `serde`, `serde_json`, `indexmap`, `unicode-normalization`, `unicode-properties`, `url`, `regex-lite`, `onenote_parser`, `typed-path`. Versions are pinned in the root `Cargo.toml`.
- Feature `specta`: derives `specta::Type` on the types that cross into the UI. Only [`wf-bindings`](wf-bindings.md) turns it on.
- Tests: `crates/wf-core/tests/` (43 files) and unit tests in the modules. `proptest` is a dev dependency; its saved cases are in `crates/wf-core/proptest-regressions/`.

Source: `crates/wf-core/src/`
