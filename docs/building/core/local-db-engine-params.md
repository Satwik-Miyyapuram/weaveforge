# Local database engine params core module

The `local_db_engine_params` module holds the start parameters for the local
PGlite engine. It adds a fixed memory cap to the engine's default parameters.
It does no I/O. The app opens the engine and passes its defaults in.

## What lives in Rust

- `crates/wf-core/src/local_db_engine_params.rs`: `LOCAL_DB_SHARED_BUFFERS`
  (`32MB`) and `engine_start_params`, which returns the defaults in order and
  appends `-c shared_buffers=32MB`. It does not change the input. The shared
  buffer cache is capped because the PGlite default of 128 MB costs about 120 MB
  of main memory for a database about 8x smaller.

## How the app calls it

The wasm exports live in `crates/wf-wasm/src/local_db_engine_params.rs`:
`localDbSharedBuffers()` and `engineStartParams(defaults)`. The wasm package
serves them directly, with TS types declared in Rust.

The sidecar (`apps/shell/sidecar/src/lifecycle.ts`) and the desktop app
(`apps/desktop/src/main-local-db.ts`) call
`rust().engineStartParams(PGlite.defaultStartParams)` from `@weaveforge/core`.
`rust()` returns the wasm module registered with `setRustCore`, so the core must
be registered before the engine opens.

## What stays in TypeScript, and why

- **Opening the engine.** `PGlite.create`, its extensions and its parsers stay
  in the sidecar and desktop code. Rust gives only the start parameters.
- **Choosing the defaults.** The defaults come from PGlite at runtime. Rust does
  not copy them, so an engine upgrade still applies.

Source: `crates/wf-core/src/local_db_engine_params.rs`
