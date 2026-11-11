# ipc_origin

Rust home: `crates/wf-core/src/ipc_origin.rs`.

## What it owns

- `same_origin(url, origin)`: scheme, hostname (case folded) and effective port must match. A default port equals its absent spelling. Either side failing to parse is not the same.
- `origin_of(url)`: `scheme//host[:port]`, or `None` when `url` does not parse.

The parse is the `url` crate's, which follows the same WHATWG rules as Node's `URL`.

## Where it is called

- wasm exports `sameOrigin` and `originOf` in `crates/wf-wasm/src/ipc_origin.rs`.
- Wrapper `packages/wf-wasm/src/rust-exports-1.ts`, typed through `rust()` in `packages/core/src/shared/rust.ts`.
- `apps/shell/sidecar/src/ipc-guard.ts`: `sameOrigin` and `originOf` call `rust()`. `originOf` still throws `Not a URL` on `null`.

## What stays in TS

The Electron event wiring, `registerGuardedIpc`, the `permitted` check and the refusal log in `ipc-guard.ts`.
