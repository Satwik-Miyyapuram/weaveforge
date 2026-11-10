# UI helpers

Four pure helpers moved from `apps/web/src/lib` into `crates/wf-core`. Each has a wasm export in `crates/wf-wasm` and a wrapper in `packages/wf-wasm`. The web files keep I/O, DOM and env reads in TS and call `readyCore()`.

| Module | Rust fn | wasm export | TS caller |
| --- | --- | --- | --- |
| `signed_out` | `is_signed_out_refusal` | `isSignedOutRefusal` | `apps/web/src/lib/session-lost.ts` |
| `view_transition` | `motion_tier`, `transitions_on`, `is_plain_click` | `motionTier`, `transitionsOn`, `isPlainClick` | `apps/web/src/lib/view-transition.ts` |
| `recent_targets` | `is_recent_target`, `pin_recent_targets` | `isRecentTarget`, `pinRecentTargets` | `apps/web/src/lib/recent-targets.ts` |
| `relay_url` | `relay_url`, `relay_path` | `relayUrl`, `relayPath` | `apps/web/src/lib/relay-url.ts` |

Rules:

- `isSignedOutRefusal` checks the error code first (`42501`, `PGRST301`, `PGRST303`), then a lowercase message needle list.
- `motionTier` takes primitives, not an object. Result is `off`, `calm`, `reactive` or `crt`.
- `pinRecentTargets` returns slot indices, so TS keeps its own item references. Recents come first with `recent: true`, unmatched items follow in order. Last recent wins on duplicates.
- `relayPath` strips the base only when the rest starts with `/`. An empty base means no base.

Not in Rust: storage, `LIMIT`, `setSessionLost`, `startFn`, `navTransition`, `relayBase()` (env and desktop check).

Status: ported without a build or test run. The `RustCoreFns` entries in `packages/core/src/shared/rust.ts` are not added, because `packages/core` does not call these functions yet.
