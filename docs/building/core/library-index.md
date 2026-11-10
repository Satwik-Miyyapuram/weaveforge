# Library index core module

`crates/wf-core/src/search/library_index.rs` holds two decisions behind the
background PDF indexer. The IO (IndexedDB, the network, pdf.js) stays in TypeScript.

## What lives in Rust

- `RETRY_AFTER_MS`: a failed paper is retried after 7 days.
- `recent_failure_ids(failures, now)`: the ids whose failure is inside the retry
  window (`now - at < RETRY_AFTER_MS`). Papers outside the window are tried again.
- `courtesy_pause_due(from_cache, indexed, failed)`: whether to pause before the
  next fetch. A cache hit makes no request, so there is no pause. Otherwise the
  pause applies once anything has been indexed or has failed.

## How the app calls it

- `wf-wasm` exports `recentFailureIds` and `courtesyPauseDue`
  (`crates/wf-wasm/src/library_index.rs`).
- `packages/wf-wasm/src/library-index.ts` wraps them, re-exported from
  `modules.ts` and `feature-wrappers.ts`.
- `apps/web/src/features/search/application/auto-index-library.ts` calls
  `readyCore().recentFailureIds` in `recentFailures()`.
- `apps/web/src/features/search/application/index-library-pdfs.ts` calls
  `readyCore().courtesyPauseDue` before each fetch.

## Parity notes

- The wasm wrapper keeps only entries whose timestamp is a JSON number. Any other
  value is dropped, so that paper is not in the window and is retried. JSON cannot
  carry NaN, so that case does not arise from storage.
- The retry window is compared with `<`, so a failure exactly 7 days old is retried.
