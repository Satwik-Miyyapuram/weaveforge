# Puller plan core module

`puller_plan.rs` holds the pure decisions of the offline-sync `Puller`
(`apps/web/src/features/offline-sync/domain/parts-2.ts`). The Puller still does
the reads, writes, transport calls and timers. It passes facts in and runs the
step that comes back.

## What lives in Rust

- `summarize_pull` (wasm `pullSummary`): from a pull page, the highest server
  seq (at least the watermark), whether more pages may follow (fetched count
  reached the page size), and for each failed change whether a newer fetched
  change for the same row exists (stale, so it is not retried).
- `apply_step` (wasm `pullApplyStep`): the step for one remote change, from
  its facts (deleted, row version, pending outbox ops, whether a conflict
  store is wired, the open conflict kind, whether it is referenced). Returns
  one of `tombstone`, `skip`, `openDeletedLocal`, `rebase`, `settleOnly`,
  `openAndWrite`, `writeAndSettle`, `writeOnly`.
- `tombstone_step` (wasm `pullTombstoneStep`): the step for a deleted remote
  change. Returns one of `dropAndWrite`, `keep`, `resolveAndWrite`,
  `openDeletedRemote`, `refuse`, `write`.
- `is_unique_clash` (wasm `isUniqueClash`) and `unique_constraint_name`
  (wasm `uniqueConstraintName`): read a unique-constraint error message.

There is no TypeScript wrapper. Its
types come from `packages/wf-wasm/src/bindings.ts`, which was hand-edited for
the new types and needs regeneration.

## What stays in TypeScript

- The synced-table guard, the outbox and conflict-store reads and writes, the
  `referenced` SQL query, `write`, `payload`, the held-row bookkeeping and the
  console warning.
- The referenced check runs only when the decision needs it (a deleted change
  with no pending ops and no open conflict).
