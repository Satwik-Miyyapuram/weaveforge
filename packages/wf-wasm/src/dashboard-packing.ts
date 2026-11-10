/**
 * Dashboard grid packing (Rust `dashboard::packing`) and fitted list-card heights (Rust `dashboard::fit`).
 * Card limits are passed in as data.
 * The item and limit types come from ./bindings.js. An unknown card type throws.
 */
import {
  dashboardCloseGaps as rawCloseGaps,
  dashboardCompactVertical as rawCompactVertical,
  dashboardLayoutFloors as rawLayoutFloors,
  dashboardNormalizeItem as rawNormalizeItem,
  dashboardPackSm as rawPackSm,
  fitLayoutToContent as rawFitLayoutToContent,
  withStoredHeights as rawStoredHeights,
} from "../pkg/wf_wasm.js";
import type {
  CardLimit,
  LayoutItem,
} from "./bindings.js";

export {
  rowsForHeight,
} from "../pkg/wf_wasm.js";

/** One card type's size limits (Rust `CardLimit`). */
export type { CardLimit as DashboardPackingLimit } from "./bindings.js";

/** One card placed on the grid (Rust `LayoutItem`). */
export type { LayoutItem as DashboardPackingItem } from "./bindings.js";

/** Min and max size of a card on a grid `cols` wide. */
export function dashboardLayoutFloors(
  limit: CardLimit,
  cols: number,
): { minW: number; minH: number; maxW: number; maxH: number } {
  return rawLayoutFloors(limit, cols) as ReturnType<typeof dashboardLayoutFloors>;
}

/** Clamp one card's size to its floors and its column to the grid. */
export function dashboardNormalizeItem(
  item: LayoutItem,
  limits: readonly CardLimit[],
  cols: number,
): LayoutItem {
  return rawNormalizeItem(item, limits, cols) as LayoutItem;
}

/** Pack cards upward with no vertical gaps. */
export function dashboardCompactVertical(
  items: readonly LayoutItem[],
  cols: number,
): LayoutItem[] {
  return rawCompactVertical(items, cols) as LayoutItem[];
}

/** Pack mobile cards into a tight 4-column grid. */
export function dashboardPackSm(
  items: readonly LayoutItem[],
  limits: readonly CardLimit[],
): LayoutItem[] {
  return rawPackSm(items, limits) as LayoutItem[];
}

/** Close the holes in a saved desktop layout. */
export function dashboardCloseGaps(
  items: readonly LayoutItem[],
  limits: readonly CardLimit[],
  cols: number,
): LayoutItem[] {
  return rawCloseGaps(items, limits, cols) as LayoutItem[];
}

/** The layout as viewed: fitting cards take their measured rows (Rust `fit_layout_to_content`). */
export function fitLayoutToContent(
  items: readonly LayoutItem[],
  measured: ReadonlyMap<string, number>,
  maxHeights: Readonly<Record<string, number>>,
): LayoutItem[] {
  return rawFitLayoutToContent(items, Object.fromEntries(measured), maxHeights) as LayoutItem[];
}

/** Each position's height, with the saved height put back where the card has one. */
export function withStoredHeights<T extends { i: string; h: number }>(
  rgl: readonly T[],
  stored: readonly LayoutItem[],
): T[] {
  const heights = rawStoredHeights(
    rgl.map((r) => r.i),
    rgl.map((r) => r.h),
    stored,
  ) as number[];
  return rgl.map((r, k) => ({ ...r, h: heights[k]! }));
}
