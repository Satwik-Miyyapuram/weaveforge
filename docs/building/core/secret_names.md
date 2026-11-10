# secret_names

Rust home: `crates/wf-core/src/secret_names.rs`.

## What it owns

- `SECRET_NAMES`: the four names the app stores, `ai-provider`, `local-api-token`, `overleaf-token` and `git-sync-token`.
- `is_secret_name(name)`: exact match against that list.

## Where it is called

- wasm export `isSecretName` in `crates/wf-wasm/src/secret_names.rs`.
- Wrapper `packages/wf-wasm/src/secret-names.ts`, typed through `rust()` in `packages/core/src/shared/rust.ts`.
- `apps/shell/sidecar/src/secret-store.ts`: `isSecretName` calls `rust()` after its `typeof` check. The TS `SECRET_NAMES` constant stays, because the type `SecretName` is derived from it.

## What stays in TS

The keychain read and write, the in-memory fallback when there is no keychain, the write queue, and the user-facing messages.
