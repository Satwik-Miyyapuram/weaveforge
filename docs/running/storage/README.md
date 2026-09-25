# Storage layer

Object/blob storage is a **separate composition layer** from relational backend and third-party integrations.

```
packages/core/src/storage/          apps/web/src/storage/
├── blob-ports.ts (IBlobStore)      ├── config.ts           ← BLOB_PROVIDER, R2, tiering knobs
└── (Phase 1: registry, tiering)    ├── wire-storage.ts     ← composition helper
                                    └── providers/
                                        supabase/           ← legacy adapter, unused (code fallback)
                                        s3/                 ← R2 + MinIO
                                        tiered/             ← hot/cold facade — what OCI runs
```

## How it fits

| Layer | Responsibility | Env prefix |
|-------|----------------|------------|
| [`backend/`](../backend.md) | Postgres repos, auth session, admin | `NEXT_PUBLIC_BACKEND_PROVIDER` |
| **`storage/`** | Files: images, artifacts, vault assets | `BLOB_PROVIDER` (server), `NEXT_PUBLIC_BLOB_PROVIDER` (browser), `R2_*`, `BLOB_COLD_*` |
| [`integrations/`](../../using/integrations.md) | Zotero, GitLab, Mattermost, … | `NEXT_PUBLIC_*_PROVIDER` |

Feature code uses **`IBlobStore`** via `PaperImageStore` — never Supabase Storage SDK directly.

## Docs

- [`../plans/completed/migration-plan.md`](../../internal/plans/completed/migration-plan.md) — how data and files moved to OCI (Postgres + tiered blobs; Supabase kept for sign-in)
- [`tiering.md`](tiering.md) — R2 hot → OCI cold eviction formula
- [`r2-setup.md`](r2-setup.md) — enable R2, create bucket, API token, env vars
- [`growth.md`](growth.md) — which *database* tables grow without bound, and what deletes them

## What is actually running

The OCI deployment runs **`BLOB_PROVIDER=tiered`** — R2 (or S3-compatible) hot, **MinIO on the OCI
box** cold, with the `blob_objects` registry tracking what is where. No files are stored at
Supabase. The env examples set `tiered`; `apps/web/.env.local.example` has the keys.

## Code fallback

`BLOB_PROVIDER` unset falls back to `SupabaseBlobStore` (Supabase Storage), the adapter from before
the move to OCI. Nothing uses it: always set `tiered`.

## Tiered

`BLOB_PROVIDER=tiered` → `TieredBlobStore` (R2 hot, MinIO cold, `blob_objects` registry). See
[`tiering.md`](tiering.md) for the eviction formula and [`r2-setup.md`](r2-setup.md) for the keys.
