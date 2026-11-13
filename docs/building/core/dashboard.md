# Dashboard core module

The `dashboard` module holds the pure rules behind the dashboard: how the card
layout is parsed, repaired and packed, and how the dashboard and supervisor
statistics are built. It does not know which cards exist. The app passes the
card limits and heights in as data.

## What lives in Rust

Source: `crates/wf-core/src/dashboard/`

- `layout.rs`: parses and repairs the saved layout, builds the default layout, merges supervisor cards and syncs the layouts.
- `packing.rs`: pure grid geometry (floors, compaction, gap closing, small-screen packing). It holds no card table of its own.
- `stats.rs`: builds the dashboard and supervision statistics. The `today` date is an argument.
- `fit.rs`: fits the card heights to their content. Card heights are passed as data.

`mod.rs` records that the rules are ported from
`packages/core/src/features/dashboard/domain`.

## How the app calls it

The wasm exports live in `crates/wf-wasm/src` (`dashboard_layout.rs`,
`dashboard_stats.rs`, `dashboard_packing.rs`). The TypeScript wrappers in
`packages/wf-wasm/src` import the raw names from `../pkg/wf_wasm.js` and
re-export them. The main names are:

- Layout (`dashboard-layout.ts`): `parseDashboardLayout`, `dashboardDefaultLayout`,
  `dashboardMergeSupervisorCards`, `dashboardAppendCardPair`, `dashboardSyncLayouts`,
  `dashboardFinalizeLayout`, `dashboardMergeRglPositions`, `dashboardLgNeedsRepair`,
  `dashboardLayoutSignature`, `dashboardSmNeedsRepack`, `dashboardLayoutCacheKey`
  (`dashboard-screen.tsx` calls it directly; `layout::cache_key` in Rust).
  The UI calls these through `readyCore()`; no TS wrappers remain.
- Packing (`dashboard-packing.ts`): `dashboardLayoutFloors`, `dashboardNormalizeItem`,
  `dashboardCompactVertical`, `dashboardPackSm`, `dashboardCloseGaps`, `rowsForHeight`,
  `fitLayoutToContent`, `withStoredHeights`.
- Stats (`dashboard-stats.ts`): `dashboardBuildStats`, `dashboardNeedsAttention`,
  `dashboardTopTags`, `dashboardSuperviseeCounts`, `dashboardTeamAttention`.

Code in `apps/web` reads these through `readyCore()` or `typedCore()` from
`apps/web/src/lib/rust-core.ts`, or through the wrappers in `packages/wf-wasm`.
`readyCore()` throws until `loadCore()` has resolved, so call it only after
the core has loaded.

## What stays in TypeScript, and why

- **Card rendering.** Components and grid drag stay in the UI. The card catalog
  (types, roles, deps, fit heights) is in Rust, see "Card registry" below.
- **Hooks and components.** Grid rendering, drag handling and the dashboard
  screens stay in `apps/web`.
- **I/O.** Loading and saving the layout to the database or local storage stays
  in TypeScript. Rust receives the saved value and returns a repaired one.
- **Type contracts.** The TypeScript types that describe the layout and stats
  shapes stay in `packages/wf-wasm/src` and `packages/core`.

## Card registry

`crates/wf-core/src/dashboard/card_registry.rs` holds the 11-card catalog: `registry()`, `card_def`,
`cards_for_role`, `is_stat_card`, `data_sources_for_card_types`, `resolve_deps` and `fit_max_heights`.
Wasm exports (`crates/wf-wasm/src/dashboard_registry.rs`): `dashboardCardRegistry`, `dashboardCardDef`,
`dashboardCardsForRole`, `dashboardIsStatCard`, `dashboardDataSourcesForCardTypes`,
`dashboardResolveDeps`, `dashboardFitMaxHeights`. `apps/web/src/features/dashboard/application/parts.ts`
delegates to them. `cardLimits()` and `fitMaxHeights()` are functions, not constants, because a module-level
call would run wasm before `loadCore()`. Tests: 9 Rust `#[test]`s, 3 of them ported from TS.

Not regenerated yet: the new exports are untyped in `packages/wf-wasm/pkg` and `packages/wf-bindings`
until `npm run bindings`; the TS side casts their results.

## Related

- [AI core](ai.md)
- [Plan core](plan.md)
- [Logbook core](logbook.md)
- [Settings core](settings.md)

Source: `crates/wf-core/src/dashboard/`

Batch 7 note: `build-dashboard-stats.ts`, `build-supervision-stats.ts` and `dashboard-layout-packing.ts` stay as TS files. They still export types and `CARD_LIMITS` used by UI and `dashboard-layout.ts`. Their wasm twins (`dashboardBuildStats`, `dashboardSuperviseeCounts`, `dashboardPackSm` and others) are called from them. `DashboardStats`, `ProgressStat`, `AttentionItem` and `LibrarySnapshot` are not in the generated `bindings.ts`, so `build-dashboard-stats.ts` stays KEEP until they are generated. Remove the TS files once the types move and the card registry is ported.
