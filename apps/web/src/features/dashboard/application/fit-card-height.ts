import type { DashboardLayoutItem } from "@weaveforge/core";
import { getCardDef } from "./card-registry";

/** Heading plus one line: the smallest a fitted list card gets. */
export const FIT_MIN_ROWS = 2;

/** Grid rows needed to show `px` of card, given the row height and the gap between rows. */
export function rowsForHeight(px: number, rowHeight: number, margin: number): number {
  if (px <= 0) return 0;
  return Math.ceil((px + margin) / (rowHeight + margin));
}

/**
 * The layout as viewed: list cards (fitContent) take the rows they measured,
 * kept between FIT_MIN_ROWS and the card's largest size. A card not measured
 * yet keeps the saved height.
 */
export function fitLayoutToContent(
  items: readonly DashboardLayoutItem[],
  measuredRows: ReadonlyMap<string, number>,
): DashboardLayoutItem[] {
  return items.map((it) => {
    const def = getCardDef(it.type);
    const rows = measuredRows.get(it.id);
    if (!def.fitContent || rows === undefined) return it;
    return { ...it, h: Math.min(def.maxSize.h, Math.max(FIT_MIN_ROWS, rows)) };
  });
}

/** RGL positions with each card's saved height put back, so a fitted height is never stored. */
export function withStoredHeights<T extends { i: string; h: number }>(
  rgl: readonly T[],
  stored: readonly DashboardLayoutItem[],
): T[] {
  const byId = new Map(stored.map((it) => [it.id, it.h]));
  return rgl.map((r) => ({ ...r, h: byId.get(r.i) ?? r.h }));
}
