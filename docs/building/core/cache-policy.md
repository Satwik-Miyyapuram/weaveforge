# Cache policy (`cache_policy`)

Rust: `crates/wf-core/src/cache_policy.rs`.
Wasm: `crates/wf-wasm/src/cache_policy.rs` (`screenCachePolicy`).
TS types: declared in Rust; served straight from the wasm package (no TS wrapper).
TS constants: `apps/web/src/lib/cache/parts-1.ts` (unchanged, THIN).

## Exports

| TS | Rust | Notes |
| --- | --- | --- |
| `screenCachePolicy()` | `screen_cache_policy() -> ScreenCachePolicy` | `{ revalidateAfterMs, showMaxAgeMs }`. |

Values: `SCREEN_REVALIDATE_AFTER_MS = 120_000`, `SCREEN_SHOW_MAX_AGE_MS = 604_800_000`.

## THIN

The cache-repo section of `apps/web/src/lib/cache/parts-1.ts` reads the limits at
call time through `readyCore().screenCachePolicy()`; they are not copied into TS.

## Parity notes

- There is no TS copy of the values to keep in step; TS reads them from Rust.
