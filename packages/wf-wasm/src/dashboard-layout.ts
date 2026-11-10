/**
 * Dashboard layout check and layout rules (Rust `dashboard::layout`), re-exported from index.ts.
 * Keeps the signature of packages/core/src/features/dashboard/domain/parse-dashboard-layout.ts.
 * The layout shape is written inline: wrapper modules declare no named types.
 */
import {
  dashboardAppendCardPair as rawAppendCardPair,
  dashboardDefaultLayout as rawDefaultLayout,
  dashboardFinalizeLayout as rawFinalizeLayout,
  dashboardLayoutSignature as rawLayoutSignature,
  dashboardLgNeedsRepair as rawLgNeedsRepair,
  dashboardMergeRglPositions as rawMergeRglPositions,
  dashboardMergeSupervisorCards as rawMergeSupervisorCards,
  dashboardSmNeedsRepack as rawSmNeedsRepack,
  dashboardSyncLayouts as rawSyncLayouts,
  parseDashboardLayout as rawParseDashboardLayout,
} from "../pkg/wf_wasm.js";

/**
 * Parse layout JSON from persistence (no compaction); invalid cards are dropped, valid ones
 * keep extra keys such as `config`. Null when `lg` or `sm` is not an array.
 */
export function parseDashboardLayout(raw: unknown): {
  lg: { id: string; type: string; x: number; y: number; w: number; h: number; config?: Record<string, unknown> }[];
  sm: { id: string; type: string; x: number; y: number; w: number; h: number; config?: Record<string, unknown> }[];
} | null {
  return rawParseDashboardLayout(raw) as ReturnType<typeof parseDashboardLayout>;
}

import type {
  CardLimit as WasmLimit,
  DashboardLayout as WasmLayout,
  LayoutItem as WasmLayoutItem,
  RglPosition as WasmRglPosition,
} from "./bindings.js";

export {
  dashboardLayoutCacheKey,
} from "../pkg/wf_wasm.js";

/** The student default layout, or the supervisor default. */
export function dashboardDefaultLayout(supervisor: boolean): WasmLayout {
  return rawDefaultLayout(supervisor) as WasmLayout;
}

/** Add missing supervisor-only cards; `ids` gives one new id per card type, in order. */
export function dashboardMergeSupervisorCards(layout: WasmLayout, limits: readonly WasmLimit[], ids: readonly string[]): WasmLayout {
  return rawMergeSupervisorCards(layout, limits, ids) as WasmLayout;
}

/** Append one card to both breakpoints under one shared id, then finalize. */
export function dashboardAppendCardPair(layout: WasmLayout, cardType: string, id: string, limits: readonly WasmLimit[]): WasmLayout {
  return rawAppendCardPair(layout, cardType, id, limits) as WasmLayout;
}

/** Repair id drift between the breakpoints. */
export function dashboardSyncLayouts(layout: WasmLayout, limits: readonly WasmLimit[]): WasmLayout {
  return rawSyncLayouts(layout, limits) as WasmLayout;
}

/** Normalize both breakpoints and pack them. */
export function dashboardFinalizeLayout(layout: WasmLayout, limits: readonly WasmLimit[]): WasmLayout {
  return rawFinalizeLayout(layout, limits) as WasmLayout;
}

/** The grid's positions for `items`, matched by id and normalized to `cols`. */
export function dashboardMergeRglPositions(
  items: readonly WasmLayoutItem[],
  rgl: readonly WasmRglPosition[],
  limits: readonly WasmLimit[],
  cols: number,
): WasmLayoutItem[] {
  return rawMergeRglPositions(items, rgl, limits, cols) as WasmLayoutItem[];
}

/** True when a desktop card is narrower than its minimum width. */
export function dashboardLgNeedsRepair(items: readonly WasmLayoutItem[], limits: readonly WasmLimit[]): boolean {
  return rawLgNeedsRepair(items, limits);
}

/** A string that changes whenever any card's id or box changes. */
export function dashboardLayoutSignature(items: readonly WasmLayoutItem[]): string {
  return rawLayoutSignature(items);
}

/** True when the mobile cards are not already in the packed order. */
export function dashboardSmNeedsRepack(items: readonly WasmLayoutItem[], limits: readonly WasmLimit[]): boolean {
  return rawSmNeedsRepack(items, limits);
}
