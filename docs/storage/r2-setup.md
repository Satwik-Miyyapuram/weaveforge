# Cloudflare R2 setup — Thesis Tracker hot tier

One-time setup for `BLOB_PROVIDER=tiered`. Cold tier (OCI MinIO) is Phase 3.

## 1. Enable R2 (required first)

The Cloudflare API returns **"Please enable R2 through the Cloudflare Dashboard"** until this is done.

1. Open [R2 Overview](https://dash.cloudflare.com/?to=/:account/r2/overview)
2. Accept terms / **Enable R2** (free tier: ~10 GB storage, zero egress)
3. Note your **Account ID** on that page → `R2_ACCOUNT_ID`

## 2. Create bucket

**Dashboard:** **Create bucket** → name: `thesis-tracker-hot` → Create

**Or Wrangler (after `wrangler login`):**

```bash
npx wrangler r2 bucket create thesis-tracker-hot --location=weur
```

Use `weur` (Western Europe) or `enam` (US East) — pick closest to your users/OCI VM.

→ `R2_BUCKET=thesis-tracker-hot`

## 3. Create R2 API token

1. R2 Overview → **Manage R2 API Tokens** → **Create API token**
2. **Permissions:** **Object Read & Write**
3. **Scope:** this bucket only (`thesis-tracker-hot`) — recommended
4. Create → copy **Access Key ID** and **Secret Access Key** (secret shown once)

| Dashboard field | `.env.local` |
|-----------------|--------------|
| Account ID | `R2_ACCOUNT_ID` |
| Access Key ID | `R2_ACCESS_KEY_ID` |
| Secret Access Key | `R2_SECRET_ACCESS_KEY` |
| Bucket name | `R2_BUCKET` |

Endpoint (automatic in app): `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`

## 4. Apply Supabase migration

Tiered mode uses `blob_objects` registry:

```bash
supabase db push
# or run supabase/migrations/0023_blob_registry.sql in SQL Editor
```

## 5. Configure app

Add to `apps/web/.env.local`:

```ini
NEXT_PUBLIC_BLOB_PROVIDER=tiered
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key_id
R2_SECRET_ACCESS_KEY=your_secret_access_key
R2_BUCKET=thesis-tracker-hot
```

`NEXT_PUBLIC_BLOB_PROVIDER` tells the **browser** to call `/api/blobs/*` instead of Supabase Storage. R2 keys stay server-only (no `NEXT_PUBLIC_` prefix). You can also set `BLOB_PROVIDER=tiered` as a server-only alias.

Restart dev:

```bash
npm run dev -w @thesis/web
```

## 6. Verify

1. Sign in → upload a paper image
2. Supabase **Table Editor** → `blob_objects` → new row, `tier = hot`
3. R2 dashboard → bucket → object under `paper-images/...`

## Troubleshooting

| Error | Fix |
|-------|-----|
| `Please enable R2` (403) | Step 1 |
| `Tiered storage requires R2_*` | Step 5 — all four R2 vars set |
| `BLOB_PROVIDER is not tiered` on API | Set `NEXT_PUBLIC_BLOB_PROVIDER=tiered`, restart |
| Upload goes to Supabase Storage | Set `NEXT_PUBLIC_BLOB_PROVIDER=tiered` (browser needs the public var) |
| Upload 401 | Sign in; check Supabase session |
| `blob_objects` insert fails | Apply migration `0023` |
| Image open shows 405 | Fixed: images use `/api/blobs/content` (not R2 presigned URLs) |
| R2 privacy / public URLs | Keep bucket **private**; app proxies reads via signed app tokens |

## Privacy

**Between app users:** User A cannot view User B's paper images unless B **shared the paper** with them (view or comment access). Shared recipients see figures on **Shared with me** and via signed `/api/blobs/content` URLs. Tokens expire after 1 hour; access is re-checked when the service role key is configured.

Apply migration `0024_blob_objects_sharing.sql` for share-aware blob registry RLS.

**R2 / Cloudflare account owner:** Anyone with your Cloudflare login or R2 API keys can list and download objects in the bucket dashboard — that is normal infrastructure admin access (same as any S3 admin). The app cannot hide objects from the bucket owner. Keep the bucket **private** (no public `r2.dev` URL) so random internet users cannot browse it.

**API routes are not web pages:** `/api/blobs/upload` and `/api/blobs/signed-urls` accept **POST** only. Opening them in the browser (GET) shows nothing or an error — use DevTools → Network while uploading/viewing images.

Token signing uses `BLOB_VIEW_SECRET`, else `SUPABASE_SERVICE_ROLE_KEY`, else `R2_SECRET_ACCESS_KEY` (already required for tiered mode).

After enabling R2 in the dashboard, ask the agent to run **`r2_bucket_create`** again via Cloudflare MCP.
