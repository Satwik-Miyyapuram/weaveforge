# Blob tiering — R2 hot, OCI cold

How the **`storage/`** layer moves infrequently used files from **Cloudflare R2** (hot) to **OCI MinIO** (cold) when the hot quota fills up.

Parent plan: [`../plans/working/migration-plan.md`](../plans/working/migration-plan.md). Layer overview: [`README.md`](README.md).

---

## Tiers

| Tier | Backend | Default quota | Role |
|------|---------|---------------|------|
| **hot** | Cloudflare R2 | 10 GB free | All new uploads; fast global reads |
| **cold** | MinIO on OCI block volume | ~100 GB | Evicted blobs; slower first read |

`wireStorage()` returns `TieredBlobStore` when `BLOB_PROVIDER=tiered`. Registry rows live in `blob_objects` (migration `0023`).

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

## Eviction score

When hot storage exceeds the high watermark, sort by **descending score** (migrate highest first).

```
score = α × days_since_last_access
      + β / log₂(access_count + 2)
      + γ × (100 − priority)
```

Defaults: `α=1.0`, `β=30.0`, `γ=0.5` — configured via `readStorageConfig()` in `apps/web/src/storage/config.ts`.

### Priority map

| Source | Condition | Priority |
|--------|-----------|----------|
| `experiment-artifacts` | experiment `done` | 20 |
| `paper-images` | paper status `read` | 30 |
| *(default)* | — | 50 |
| `experiment-artifacts` | experiment `running` | 70 |
| `vault-assets` | section `drafting` | 80 |

---

## Tier job behaviour

1. Measure R2 usage
2. If ≥ 85% of `BLOB_HOT_QUOTA_GB`, migrate highest-score hot objects
3. Stop at 75% or `BLOB_TIER_BATCH_SIZE`
4. Optional promote cold → hot on repeated access (`BLOB_PROMOTE_ON_ACCESS`)

---

## Configuration

Set in `.env.local` or host secrets — see `apps/web/src/storage/config.ts` for all keys:

```ini
BLOB_PROVIDER=tiered            # server: supabase | tiered
NEXT_PUBLIC_BLOB_PROVIDER=tiered  # browser: supabase | tiered
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=thesis-tracker-hot
BLOB_COLD_ENDPOINT=
BLOB_COLD_ACCESS_KEY_ID=
BLOB_COLD_SECRET_ACCESS_KEY=
BLOB_COLD_BUCKET=thesis-tracker-cold
```

---

## Code layout

```
apps/web/src/storage/
├── config.ts
├── wire-storage.ts
└── providers/
    ├── supabase/blob-store.ts   ← today
    ├── s3/blob-store.ts         ← Phase 1
    └── tiered/tiered-blob-store.ts
```
