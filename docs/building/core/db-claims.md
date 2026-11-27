# db_claims

> **Historical:** describes the database sync engine retired in 0.9.8 (the web `offline-sync` feature was removed in `4a7e678b3`). Workspace files are the source of truth now; see `docs/building/core/README.md`.

Rust home: `crates/wf-core/src/db_claims.rs`.

## What it owns

- `session_claims(user)`: the `request.jwt.claims` JSON that row-level security policies read. A user id gives `{"sub":"<id>","role":"authenticated"}`, with keys in that order and the id JSON-escaped. `None` or an empty id gives `{"role":"anon"}`, which policies refuse.

## Where it is called

- wasm export `sessionClaims` in `crates/wf-wasm/src/db_claims.rs`, re-exported as is (no TS wrapper) from `packages/wf-wasm/src/index.ts`.
- `apps/web/src/backend/test/pg-test-db.ts` through `readyCore()`.

## What stays in TS

Nothing. The TS `sessionClaims` in `packages/core/src/database/local-postgres.ts` is deleted.
