# local_secrets

Rust home: `crates/wf-core/src/sync/local_secrets.rs`. wasm: `crates/wf-wasm/src/sync_local_secrets.rs`.
TS caller: `apps/web/src/backend/providers/local/parts.ts` (`DeviceSecretsStore`).

## What moved

- The load and save SQL for the device's secrets row (`localSecretsLoadSql`, `localSecretsSaveSql`).
- Reading the stored text back into JSON (`localSecretsJsonText`): the saved JSON, or `{}` when absent.

## What stays in TS

- Running the SQL through PGlite (`this.run`).
- The `JSON.parse` of the returned text and the in-memory cache.

## Tests

4 `it:` cases moved to `#[test]` in `local_secrets.rs`. PGlite-backed tests stay TS.
