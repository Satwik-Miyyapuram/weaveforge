/**
 * Dashboard grid packing (Rust `dashboard::packing`). Card limits are passed in as data.
 * The item and limit types come from ./bindings.js. An unknown card type throws.
 */
import {
  dashboardCloseGaps as rawCloseGaps,
  dashboardCompactVertical as rawCompactVertical,
  dashboardLayoutFloors as rawLayoutFloors,
  dashboardNormalizeItem as rawNormalizeItem,
  dashboardPackSm as rawPackSm,
} from "../pkg/wf_wasm.js";
import type { CardLimit, LayoutItem } from "./bindings.js";

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
