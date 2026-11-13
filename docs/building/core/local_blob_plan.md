# local_blob_plan

Rust home: `crates/wf-core/src/sync/local_blob_plan.rs`. wasm: `crates/wf-wasm/src/sync_local_blob_plan.rs`.
TS callers: `apps/web/src/backend/providers/local/parts-1.ts` (`LocalBlobStore`, `LocalFirstBlobStore`).

## What moved

- Local blob SQL by name (`localBlobSql`, `None` for an unknown name) and the read SQL for N paths (`localBlobReadSql`).
- Whether removing a blob forgets its unsent upload (`localBlobRemovalForgetsUpload`).
- Which paths to ask the server for (`localBlobMissingPaths`, value-based, for the value list).
- The index-based filter in `LocalFirstBlobStore.signedUrls`: the positions whose link this computer lacks, in order
  (`localBlobUnsignedIndices`, `unsigned_indices`). Index-based, so duplicate paths resolve by position as before.
- Merging signed URLs from this computer and the server (`localBlobMergeSignedUrls`).

## What stays in TS

- Pglite queries, `fetch`, and the server wrapper.
- The call order in `signedUrls`: read the unsigned positions from Rust, fetch only those paths, then merge.

## Known divergence and GAPs

- None in the decisions. The index filter moved to Rust, so the earlier GAP is closed.

## Tests

7 `it:` cases moved to `#[test]` in `local_blob_plan.rs`, plus `unsigned_indices_are_the_null_positions_in_order`.
PGlite-backed and fetch-backed tests stay TS.
