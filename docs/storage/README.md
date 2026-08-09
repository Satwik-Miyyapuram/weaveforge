# Storage layer

Object/blob storage is a **separate composition layer** from relational backend and third-party integrations.

```
packages/core/src/storage/          apps/web/src/storage/
├── blob-ports.ts (IBlobStore)      ├── config.ts           ← BLOB_PROVIDER, R2, tiering knobs
└── (Phase 1: registry, tiering)    ├── wire-storage.ts     ← composition helper
                                    └── providers/
                                        supabase/           ← default today
                                        s3/                 ← Phase 1: R2 + MinIO
                                        tiered/             ← Phase 1: hot/cold facade
```

## How it fits

| Layer | Responsibility | Env prefix |
|-------|----------------|------------|
| [`backend/`](../backend.md) | Postgres repos, auth session, admin | `NEXT_PUBLIC_BACKEND_PROVIDER` |
| **`storage/`** | Files: images, artifacts, vault assets | `BLOB_PROVIDER` (server), `NEXT_PUBLIC_BLOB_PROVIDER` (browser), `R2_*`, `BLOB_COLD_*` |
| [`integrations/`](../integrations.md) | Zotero, GitLab, Mattermost, … | `NEXT_PUBLIC_*_PROVIDER` |

Feature code uses **`IBlobStore`** via `PaperImageStore` — never Supabase Storage SDK directly.

## Docs

- [`../plans/completed/migration-plan.md`](../plans/completed/migration-plan.md) — phased self-host (Postgres + tiered blobs, Supabase Auth)
- [`tiering.md`](tiering.md) — R2 hot → OCI cold eviction formula
- [`r2-setup.md`](r2-setup.md) — enable R2, create bucket, API token, env vars
- [`growth.md`](growth.md) — which *database* tables grow without bound, and what deletes them

## Default today

`BLOB_PROVIDER=supabase` (or unset) → `SupabaseBlobStore` wired from `wire-supabase-backend` via `wireStorage()`.

## Phase 1 target

`BLOB_PROVIDER=tiered` → `TieredBlobStore` (R2 hot, MinIO cold, `blob_objects` registry).
