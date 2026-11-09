/**
 * Grid packing for the dashboard: pull cards up, pack the mobile grid, and
 * close holes in a saved desktop layout, each card kept within its size limits.
 * The geometry runs in Rust (wf-core `dashboard::packing`); this module supplies
 * each card's size limits from the card registry. Pure, no storage.
 */

import type { DashboardLayoutItem } from "@weaveforge/core";

import { readyCore } from "@/lib/rust-core";

import { CARD_REGISTRY } from "./card-registry";

type CardSizeDef = (typeof CARD_REGISTRY)[number];

const CARD_LIMITS = CARD_REGISTRY.map((def) => ({
  type: def.type,
  minSize: def.minSize,
  maxSize: def.maxSize,
  defaultSize: def.defaultSize,
  defaultSizeSm: def.defaultSizeSm,
}));

/** Min/max for a card on a given column count (mobile vs desktop semantics differ). */
export function layoutFloors(def: CardSizeDef, cols: number) {
  return readyCore().dashboardLayoutFloors(
    {
      type: def.type,
      minSize: def.minSize,
      maxSize: def.maxSize,
      defaultSize: def.defaultSize,
      defaultSizeSm: def.defaultSizeSm,
    },
    cols,
  );
}

export function normalizeLayoutItem(
  item: DashboardLayoutItem,
  cols = 12,
): DashboardLayoutItem {
  return readyCore().dashboardNormalizeItem(item, CARD_LIMITS, cols) as DashboardLayoutItem;
}

/** Pack items upward with no vertical gaps (react-grid-layout compact). */
export function compactLayoutVertical(
  items: readonly DashboardLayoutItem[],
  cols: number,
): DashboardLayoutItem[] {
  return readyCore().dashboardCompactVertical(items, cols) as DashboardLayoutItem[];
}

/** Pack mobile cards into a tight 4-column grid (row-major, no gaps). */
export function packSmLayout(items: readonly DashboardLayoutItem[]): DashboardLayoutItem[] {
  return readyCore().dashboardPackSm(items, CARD_LIMITS) as DashboardLayoutItem[];
}

/** Mobile: snap half/full width, then pack into a compact grid. */
export function normalizeSmLayout(items: readonly DashboardLayoutItem[]): DashboardLayoutItem[] {
  return packSmLayout(items);
}

/**
 * Close the holes in a desktop layout saved before the current default.
 *
 * Packing upward (`compactLayoutVertical`) cannot fill a hole *beside* a card:
 * a row of three stat tiles leaves three empty columns, and a card that was
 * narrowed leaves its old width empty. Here each card, in reading order, takes
 * the first place it fits scanning row by row, and then any card with free
 * columns to its right widens into them, and a short card beside a tall one
 * grows down into the hole under it, each up to its maximum size. Order is
 * kept; cards only move, widen and lengthen.
 *
 * Run when a saved layout is loaded, not while editing, so a card someone is
 * resizing is not pulled out from under the pointer.
 */
export function closeLayoutGaps(items: readonly DashboardLayoutItem[], cols = 12): DashboardLayoutItem[] {
  return readyCore().dashboardCloseGaps(items, CARD_LIMITS, cols) as DashboardLayoutItem[];
}
