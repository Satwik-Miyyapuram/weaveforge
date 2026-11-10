# Storage core module

The `storage` module holds the rules for blob storage: which content types a
blob may have, the order in which cold-tier blobs are evicted, how storage is
configured from the environment, which blob paths may be signed, and how the
S3-compatible clients are configured. It does no I/O. The app supplies the
environment, the clock and the object store.

## What lives in Rust

- `config.rs`: blob storage config from the environment, and the blob provider
  choice at runtime. The caller passes the env map. A missing value and an empty
  value both mean unset.
- `blob.rs`: blob content types and the cold-tier eviction order. Times are epoch
  milliseconds, and `now` is passed in.
- `blob_access.rs`: the blob access rules that the relay's `/api/blobs/*` routes
  enforce, and the limits on signed URL paths. It checks only. It has no clock,
  so callers pass `now`.
- `blob_client.rs`: the S3-compatible client config for the R2 hot tier and the
  MinIO cold tier. It builds the config only.
- `mod.rs`: the module head and the re-exports.

## How the app calls it

The wasm exports live in `crates/wf-wasm/src` (`storage_config.rs`,
`storage_blob_access.rs`). The TypeScript wrappers in `packages/wf-wasm/src`
import the raw names from `../pkg/wf_wasm.js` and re-export them. The main names
are `readStorageConfig`, `blobProviderForRuntime`, `r2BlobClientConfig`,
`coldBlobClientConfig`, `missingR2ConfigMessage` and `maxSignedUrlPaths`.

Code in `apps/web` reads these through `readyCore()` from
`apps/web/src/lib/rust-core.ts`. Examples:

- `apps/web/src/storage/config.ts` calls `readyCore().readStorageConfig`.
- `apps/web/src/storage/wire-storage.ts` calls `readyCore().blobProviderForRuntime`.
- `apps/web/src/storage/providers/s3/s3-blob-store.ts` calls
  `readyCore().r2BlobClientConfig`, and the cold-tier config is read the same way.

Call `readyCore()` only after `loadCore()` has resolved.

## What stays in TypeScript, and why

- **The S3 client and object I/O.** The AWS client, uploads, downloads and
  deletes live in `apps/web/src/storage/providers/s3/s3-blob-store.ts`. Rust
  returns the config that the client is built from.
- **The HTTP routes.** The `/api/blobs/*` handlers read requests and write
  responses in the app. They call the access rules from Rust.
- **The clock.** The app reads the time and passes `now` in, so the access rules
  take no clock of their own and stay testable.
- **Secrets and environment reads.** The app reads the process environment and
  hands the map to Rust. Rust never reads the environment itself.

## Related

- [Workspace core](workspace.md)
- [Sync core](sync.md)
- [Vault core](vault.md)

Source: `crates/wf-core/src/storage/`
