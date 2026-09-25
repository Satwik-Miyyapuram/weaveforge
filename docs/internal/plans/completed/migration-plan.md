# Self-host migration plan (Postgres + tiered blobs)

Phased path from **Supabase Cloud** (managed Postgres + Auth) to **self-hosted Postgres** with optional **tiered blob storage** (R2 hot + OCI MinIO cold), while keeping Supabase Auth as the identity provider (Option A).

**Index:** [`../../self-host-roadmap.md`](../../strategy/self-host-roadmap.md) · **OCI runbook:** [`../../backend/oracle-shift-guide.md`](../../../running/oracle-shift.md)

---

## Phases

| Phase | Status | Work |
|-------|--------|------|
| 0 Schema | Done | Apply all files in [`supabase/migrations/`](../../../../supabase/migrations/) (`0001` … latest) on Supabase Cloud |
| 1 Storage (R2 hot) | Done | Optional `NEXT_PUBLIC_BLOB_PROVIDER=tiered` — see [`../../storage/r2-setup.md`](../../../running/storage/r2-setup.md) |
| 2 Postgres code | Done | `wire-postgres-backend.ts` + contract tests — not used in prod yet |
| 3 OCI infra | Paused | VM + Postgres + MinIO — [`../../backend/oracle-shift-guide.md`](../../../running/oracle-shift.md) |
| 4 Shadow migrate | Not started | Export Supabase relational data → OCI Postgres; blobs → R2. No automated scripts in repo yet. |
| 5 Cutover | Not started | Point `DATABASE_URL` at OCI; set `NEXT_PUBLIC_BACKEND_PROVIDER=postgres` on server; keep Supabase Auth env vars |
| 6 Auto tiering | Not started | Cron eviction R2 → MinIO — [`../../storage/tiering.md`](../../../running/storage/tiering.md) |

**Supported today:** Phase 0 on Supabase Cloud + optional Phase 1 tiered blobs.

---

## Schema apply order (self-hosted Postgres)

> **Corrected after the fact.** This section originally applied the two folders in
> the opposite order, which cannot work: the base chain uses `auth.users`,
> `auth.uid()`, `storage.buckets` and the Supabase roles from its first file, so
> `0001_papers.sql` fails on a stock Postgres. The stubs go first. The numbers
> below are also of their time — the chain runs past `0131` now.

1. Files in [`supabase/migrations-self-hosted-postgres/`](../../../../supabase/migrations-self-hosted-postgres/)
   (the furniture a stock Postgres lacks).
2. Then every file in [`supabase/migrations/`](../../../../supabase/migrations/) in numeric order.

```bash
for f in supabase/migrations-self-hosted-postgres/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
for f in supabase/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
```

E2EE requires migrations `0037` onward, and `0099` then removes that schema again. Full feature parity
with the web app needs the complete chain (see [`supabase/migrations/README.md`](../../../../supabase/migrations/README.md)
for the current list).

---

## Cutover env (Phase 5 sketch)

```ini
# Relational — self-hosted
DATABASE_URL=postgres://thesis:PASSWORD@HOST:5432/thesis
NEXT_PUBLIC_BACKEND_PROVIDER=postgres

# Auth — still Supabase (Option A)
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Blobs — tiered (optional)
NEXT_PUBLIC_BLOB_PROVIDER=tiered
BLOB_PROVIDER=tiered
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=weaveforge-hot
BLOB_COLD_ENDPOINT=http://OCI_IP:9000
BLOB_COLD_BUCKET=weaveforge-cold
```

---

## Related docs

| Topic | Path |
|-------|------|
| Roadmap index | [`../../self-host-roadmap.md`](../../strategy/self-host-roadmap.md) |
| Postgres provider | [`../../backend/postgres-provider.md`](../../../running/postgres-provider.md) |
| R2 setup | [`../../storage/r2-setup.md`](../../../running/storage/r2-setup.md) |
| Tiering formula | [`../../storage/tiering.md`](../../../running/storage/tiering.md) |
| Migration folders | [`../../../supabase/README.md`](../../../../supabase/README.md) |
