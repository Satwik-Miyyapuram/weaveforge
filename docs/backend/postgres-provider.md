# Postgres backend provider (Phase 2)

**Status:** Complete — all repositories wired; ready for OCI cutover after migrations + smoke tests.

## Goal

`NEXT_PUBLIC_BACKEND_PROVIDER=postgres` + `DATABASE_URL` → app tables on self-hosted Postgres; **Supabase Auth unchanged** (Option A).

## Done

| Item | Location |
|------|----------|
| `pg` pool + RLS session (`request.jwt.claim.sub`) | `backend/providers/postgres/pool.ts`, `pg-runner.ts` |
| Self-host auth stubs | `supabase/migrations-self-hosted-postgres/0025_self_host_auth.sql` |
| All Postgres repositories | `backend/providers/postgres/repositories/` |
| Blob registry | `storage/providers/postgres/blob-registry.ts` |
| Full wire | `wire-postgres-backend.ts` (mirrors Supabase composition root) |
| Tiered blob API | `storage/server/blob-api.ts` picks Postgres registry when backend = postgres |

## Local dev (OCI / self-hosted Postgres)

Postgres wiring uses the Node `pg` driver — **server-only** (API routes). The browser bundle must keep `NEXT_PUBLIC_BACKEND_PROVIDER=supabase` until Phase 5 adds a client-facing API layer.

Phase 5 arrived as PostgREST rather than a Next API layer: the browser keeps speaking the protocol it already speaks, and the cutover is `NEXT_PUBLIC_DATA_URL` — [`oracle-shift-guide.md`](oracle-shift-guide.md). `NEXT_PUBLIC_BACKEND_PROVIDER` stays `supabase` in any deployed app.

Server-side only (API routes, scripts, local dev):

```ini
NEXT_PUBLIC_BACKEND_PROVIDER=postgres
DATABASE_URL=postgres://user:pass@localhost:5432/thesis
NEXT_PUBLIC_BLOB_PROVIDER=tiered
# Auth still Supabase:
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
# R2 for hot tier (see docs/storage/r2-setup.md)
```

Apply every file in [`supabase/migrations/`](../../supabase/migrations/) on your Postgres (through latest — E2EE needs `0037+`), then [`supabase/migrations-self-hosted-postgres/`](../../supabase/migrations-self-hosted-postgres/). See [`plans/completed/migration-plan.md`](../plans/completed/migration-plan.md).

`0025` creates a minimal `auth.users` stub with **RLS enabled** and **no policies**. Sync user ids from Supabase via service role or direct postgres.

## Testing

Contract tests in `packages/core` against in-memory repos. Add live `DATABASE_URL` integration tests mirroring Supabase integration tests before production cutover.
