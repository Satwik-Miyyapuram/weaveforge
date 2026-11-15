# Blob tiering — R2 hot, OCI cold

How the **`storage/`** layer stores blobs. Uploads go to **Cloudflare R2** (hot). The **OCI MinIO** cold store is configured but nothing moves objects to it yet; the eviction design is at the end of this page.

Parent plan: [`../plans/completed/migration-plan.md`](../../internal/plans/completed/migration-plan.md). Layer overview: [`README.md`](README.md).

---

## Tiers

| Tier | Backend | Default quota | Role |
|------|---------|---------------|------|
| **hot** | Cloudflare R2 | 10 GB free | All uploads; fast global reads |
| **cold** | MinIO on OCI block volume | ~100 GB (design) | Configured via `BLOB_COLD_*`; only used when a caller tags an object `cold`. No code moves objects there. |

In the browser, `wireStorage()` returns `HttpBlobStore` for `tiered`, which calls the relay's `/api/blobs/*` routes. Tiering is served by the relay (`apps/relay/server/src/storage.rs`, `blob_routes.rs`). Registry rows live in `blob_objects` (migration `0023`).

---

## Registry (`blob_objects`)

| Column | Purpose |
|--------|---------|
| `bucket`, `path` | Logical key (`paper-images`, `experiment-artifacts`, …) |
| `tier` | `hot` \| `cold` |
| `size_bytes` | Quota math |
| `access_count` | Incremented on signed URL request |
| `last_accessed_at` | Updated on read |
| `priority` | 0–100 business weight |
| `created_at` | Upload time |

---

---

## Configuration

Set in `.env.local` or host secrets. Provider keys are read by `apps/web/src/storage/config.ts`. `BLOB_HOT_QUOTA_GB`, `BLOB_TIER_BATCH_SIZE` and `BLOB_PROMOTE_ON_ACCESS` are not read anywhere in the repo, because the tier job is not built:

```ini
BLOB_PROVIDER=tiered            # server: supabase | tiered
NEXT_PUBLIC_BLOB_PROVIDER=tiered  # browser: supabase | tiered
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=weaveforge-hot
BLOB_VIEW_SECRET=               # signs view tokens; openssl rand -base64 48
BLOB_COLD_ENDPOINT=
BLOB_COLD_ACCESS_KEY_ID=
BLOB_COLD_SECRET_ACCESS_KEY=
BLOB_COLD_BUCKET=weaveforge-cold
```

---

## Code layout

```
apps/web/src/storage/
├── config.ts
├── wire-storage.ts              ← browser HttpBlobStore; SupabaseBlobStore (legacy default)
└── providers/
    ├── http/http-blob-store.ts
    ├── postgrest/blob-registry.ts
    ├── s3/s3-blob-store.ts
    └── tiered/tiered-blob-store.ts
```

---

## Not built yet (design)

### Eviction score

When hot storage exceeds the high watermark, sort by **descending score** (migrate highest first).

```
score = α × days_since_last_access
      + β / log₂(access_count + 2)
      + γ × (100 − priority)
```

Defaults `α=1.0`, `β=30.0`, `γ=0.5` are design values. **Not implemented:** no code in the repo computes this score or reads these weights. `access_count` appears only in `db/migrations/0023_blob_registry.sql` and `0125_atomic_write_rpcs.sql`.

#### Priority map

| Source | Condition | Priority |
|--------|-----------|----------|
| `experiment-artifacts` | experiment `done` | 20 |
| `paper-images` | paper status `read` | 30 |
| *(default)* | — | 50 |
| `experiment-artifacts` | experiment `running` | 70 |
| `vault-assets` | section `drafting` | 80 |

---

### Tier job behaviour

**Not implemented:** a search of the repo finds no tier job that measures R2 usage or moves objects.

1. Measure R2 usage
2. If ≥ 85% of `BLOB_HOT_QUOTA_GB`, migrate highest-score hot objects
3. Stop at 75% or `BLOB_TIER_BATCH_SIZE`
4. Optional promote cold → hot on repeated access (`BLOB_PROMOTE_ON_ACCESS`)
