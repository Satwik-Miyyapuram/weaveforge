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
  `dashboardLayoutSignature`, `dashboardSmNeedsRepack`.
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

- **The card registry.** `apps/web/src/features/dashboard/application/card-registry.ts`
  owns the card table: which cards exist, their limits and their heights. It
  calls `roleRank` through `readyCore()` to filter cards by role, and passes
  the limits into the Rust layout functions as data. The table stays in
  TypeScript because it is UI configuration, not a rule.
- **Hooks and components.** Grid rendering, drag handling and the dashboard
  screens stay in `apps/web`.
- **I/O.** Loading and saving the layout to the database or local storage stays
  in TypeScript. Rust receives the saved value and returns a repaired one.
- **Type contracts.** The TypeScript types that describe the layout and stats
  shapes stay in `packages/wf-wasm/src` and `packages/core`.

## Related

- [AI core](ai.md)
- [Plan core](plan.md)
- [Logbook core](logbook.md)
- [Settings core](settings.md)

Source: `crates/wf-core/src/dashboard/`
