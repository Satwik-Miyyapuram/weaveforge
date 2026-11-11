# CRDT log compaction (core)

Rust owns the rule for whether a compaction request should be sent. The
TypeScript use case keeps the IO shell: it calls the database-side `compact`
through the CRDT update store, which moves the watermark and sweeps covered rows
in one transaction.

## Where things live

| Concern | Owner | Path |
| --- | --- | --- |
| No-op rules (`nothing-to-do`, `stale`) | Rust | `crates/wf-core/src/collab.rs` (`compact_skip_reason`) |
| Wasm export `compactSkipReason` | Rust | `crates/wf-wasm/src/leaf_ports.rs` |
| Typed wasm wrapper | TS | `packages/wf-wasm/src/wrappers-3.ts` |
| Typed through `rust()` (generated wasm declarations) | TS | `packages/core/src/shared/rust.ts` |
| Use case (thin shell) | TS | `packages/core/src/features/collab/application/compact-crdt-log.use-case.ts` |
| Store port and `CompactOutcome` | TS | `packages/core/src/features/collab/domain/crdt-update-store.ts` |
| Watermark move and sweep | Database | `db/migrations/0132_compact_crdt_log_rpc.sql` |

## Rules

`compact_skip_reason(snapshot_upto_id, current_upto)` returns:

- `"nothing-to-do"` when `snapshot_upto_id <= 0` (no snapshot covers an update).
- `"stale"` when `current_upto` is known and `snapshot_upto_id <= current_upto`
  (another writer already covered that range).
- `None` otherwise, meaning the request goes to the store.

`current_upto` of `None` (JS `undefined` or `null`) means "not known", which is
not zero. The database still refuses a rewind, so `current_upto` is a courtesy
check, not the guard.

## Not ported

- The store call and the database RPC stay where they are.
- The body-write barrier (`RealtimeYjsProvider`) stays in `apps/web`. A use case
  cannot see whether a document's text has landed.
- No new serializable type, so no specta derive or `wf-bindings` registration
  was needed.

## Build note

The wasm package must be rebuilt before `compactSkipReason` exists at runtime.
