# Project LWW invalidator (`cache_invalidation`)

Rust: `crates/wf-core/src/cache_invalidation.rs` (`write_scope`, `lww_clear_target`, `lww_notify_resource`).
Wasm: `crates/wf-wasm/src/cache_invalidation.rs` (`writeScope`, `lwwClearTarget`, `lwwNotifyResource`).
TS wrapper: `packages/wf-wasm/src/index.ts` (wrapper functions next to `invalidationMap`).
TS shim: `apps/web/src/lib/cache/parts-1.ts` (kept; many importers).

## Exports

| TS (via `readyCore()`) | Rust | Notes |
| --- | --- | --- |
| `writeScope(resourceType)` | `write_scope(resource) -> Option<WriteScope>` | `{ repoTypes, screens }`. Written type first, then the plan's repos, deduped. `null` for unknown names. |
| `lwwClearTarget(name)` | `lww_clear_target(Option<&str>) -> Option<String>` | The name when known, else `null`. |
| `lwwNotifyResource(name)` | `lww_notify_resource(Option<&str>) -> Option<String>` | The name when non-empty, else `null`. Sent as the broadcast payload. |

`WriteScope` is specta-registered in `crates/wf-bindings/src/lib.rs`.

## THIN (stays in TS)

- The realtime channel `proj:{projectId}`, `setAuth`, `subscribe`, and the unsubscribe on `watch`/`dispose`.
- Timers and the local-mode guard (`isLocalMode`).
- Module-level hooks (`configureProjectCacheHooks`, `clearProjectCacheHooks`) and the repo cache registry.
- `logToApp` and `formatError` calls.
- Screen cache clearing (`clearScreenCachesForScreens`, `clearAllScreenCaches`).

## Parity notes

- `lwwNotifyResource` and the wasm `check_text` on the `Some` values may throw where the TS did not. Unverified.
- `invalidateForWrite` builds the same repo-type set as before (written type plus plan repos).
