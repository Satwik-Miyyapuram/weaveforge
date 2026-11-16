# CRDT log compaction (core)

Rust owns the whole compaction request. The `crdt_updates` repo's `compact` arm
applies the no-op rules and then calls the database-side `compact_crdt_log` RPC,
which moves the watermark and sweeps covered rows in one transaction. There is no
TypeScript use case; `RealtimeYjsProvider` calls the arm through the CRDT update
store.

## Where things live

| Concern | Owner | Path |
| --- | --- | --- |
| No-op rules and RPC call (`compact` arm) | Rust | `crates/wf-core/src/repos/crdt_updates.rs` |
| Store port and `CompactOutcome` | TS | `packages/core/src/features/collab/domain/crdt-update-store.ts` |
| Body-write barrier, then `compact` | TS | `apps/web/src/features/collab/infrastructure/realtime-yjs-provider.ts` |
| Watermark move and sweep | Database | `db/migrations/0132_compact_crdt_log_rpc.sql` |

## Rules

`compact(input)` returns, without a query:

- `{ status: "no-op", reason: "nothing-to-do" }` when `uptoId <= 0` (no
  snapshot covers an update).
- `{ status: "no-op", reason: "stale" }` when `currentUpto` is known and
  `uptoId <= currentUpto` (another writer already covered that range).

Otherwise it calls `compact_crdt_log`. The refusals `42501` and `P0002` become
outcomes; any other error fails with its message. On success it returns
`{ status: "compacted", deleted }`.

`currentUpto` absent means "not known", which is not zero. The database still
refuses a rewind, so `currentUpto` is a courtesy check, not the guard.

## Not ported

- The body-write barrier stays in `apps/web`: only the provider can see whether
  a document's text has landed.
