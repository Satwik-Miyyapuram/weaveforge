# db_claims

Rust home: `crates/wf-core/src/db_claims.rs`.

## What it owns

- `session_claims(user)`: the `request.jwt.claims` JSON that row-level security policies read. A user id gives `{"sub":"<id>","role":"authenticated"}`, with keys in that order and the id JSON-escaped. `None` or an empty id gives `{"role":"anon"}`, which policies refuse.

## Where it is called

- Shell: `apps/shell/src/local_pg/db.rs` re-exports it; `claims_for` maps "no user given" to the local-only user.
- wasm export `sessionClaims` in `crates/wf-wasm/src/db_claims.rs`, re-exported as is (no TS wrapper) from `packages/wf-wasm/src/index.ts`.
- `apps/shell/sidecar/src/local-db.ts` through `rust()` (typed in `packages/core/src/shared/rust.ts`).
- `apps/web/src/backend/test/pg-test-db.ts` through `readyCore()`.

## What stays in TS

Nothing. The TS `sessionClaims` in `packages/core/src/database/local-postgres.ts` is deleted.
