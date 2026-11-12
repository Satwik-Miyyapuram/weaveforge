# secret_names

Rust home: `crates/wf-core/src/secret_names.rs`.

## What it owns

- `SECRET_NAMES`: the four names the app stores, `ai-provider`, `local-api-token`, `overleaf-token` and `git-sync-token`.
- `is_secret_name(name)`: exact match against that list.

## Where it is called

- wasm export `isSecretName` in `crates/wf-wasm/src/secret_names.rs`.
- No TS wrapper; typed through `rust()` in `packages/core/src/shared/rust.ts`.
- The native shell keeps its own list: `SECRET_NAMES` and `known()` in `apps/shell/src/secrets.rs`.

## What stays in TS

The keychain read and write, the in-memory fallback when there is no keychain, the write queue, and the user-facing messages.
