# push_plan

Offline-sync gates that were still TypeScript-only. Rust: `wf-core::sync::push_plan`; wasm: `sync_push_plan.rs`; no TS wrapper (typed in Rust).

| Rust fn | JS | Replaces (TS) |
| --- | --- | --- |
| `continue_push_round(sent, stopped_early)` | `continuePushRound` | `push()` loop break in `domain/sync-engine.ts` |
| `should_recover_unsent(has_account, resend_checked)` | `shouldRecoverUnsent` | gate at the top of `recoverUnsent()` in `domain/sync-engine.ts` |
| `group_eligible(deleted, unique_clash, pending_ops)` | `groupEligible` | candidate filter in `applyGroups()` in `domain/puller.ts` |

## Rules

- A push round continues only if it sent something and the network did not stop it.
- Unsent rows are checked once, and only when an account is set.
- A table group takes live rows refused on a unique clash, with nothing owed for the row.

## Not in Rust

- The pump's per-row stall set (`domain/pump.ts`): bookkeeping interleaved with I/O.
- Outbox, conflict and live-sync SQL and listeners: I/O.

## Status

Ported with unit tests. Not built or tested in this lane.
