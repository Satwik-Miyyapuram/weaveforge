# local_identity

Rust home: `crates/wf-core/src/sync/local_identity.rs`. wasm: `crates/wf-wasm/src/sync_local_identity.rs`.
TS caller: `apps/web/src/backend/providers/local/local-identity.ts`.

## What moved

- The localStorage key of the local-mode choice (`localModeKey`).
- Local-mode reading: only the stored `"1"` turns it on (`localIsLocalMode`).

## What stays in TS

- localStorage reads and writes (`safe-storage`), the `LOCAL_USER` object, `LocalAuthService`, the session
  promise cache, and the `setTimeout` in `onChange`.

## Known divergence

- None.

## Tests

`local_mode_is_on_only_for_the_stored_one` in `local_identity.rs`.
