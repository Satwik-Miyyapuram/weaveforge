/**
 * Dashboard layout check and layout rules (Rust `dashboard::layout`), re-exported from index.ts.
 * Keeps the signature of packages/core/src/features/dashboard/domain/parse-dashboard-layout.ts.
 * The layout shape is written inline: wrapper modules declare no named types.
 */

export {
  dashboardAppendCardPair,
  dashboardDefaultLayout,
  dashboardFinalizeLayout,
  dashboardLayoutCacheKey,
  dashboardLayoutSignature,
  dashboardLgNeedsRepair,
  dashboardMergeRglPositions,
  dashboardMergeSupervisorCards,
  dashboardSmNeedsRepack,
  dashboardSyncLayouts,
  parseDashboardLayout,
} from "../pkg/wf_wasm.js";
