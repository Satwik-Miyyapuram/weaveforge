# Cache policy (`cache_policy`)

Rust: `crates/wf-core/src/cache_policy.rs`.
Wasm: `crates/wf-wasm/src/cache_policy.rs` (`screenCachePolicy`).
TS wrapper: `packages/wf-wasm/src/wrappers-9.ts` (star-exported from `index.ts`).
TS constants: `apps/web/src/lib/cache/parts-1.ts` (unchanged, THIN).

## Exports

| TS | Rust | Notes |
| --- | --- | --- |
| `screenCachePolicy()` | `screen_cache_policy() -> ScreenCachePolicy` | `{ revalidateAfterMs, showMaxAgeMs }`. |

Values: `SCREEN_REVALIDATE_AFTER_MS = 120_000`, `SCREEN_SHOW_MAX_AGE_MS = 604_800_000`.

## THIN

The TS constants stay in `apps/web/src/lib/cache/parts-1.ts`. `cache-repo.ts`
reads them at module evaluation, before wasm is loaded, so they cannot call Rust.

## Parity notes

- The Rust values are a copy of the TS constants. Keep them in step by hand.
