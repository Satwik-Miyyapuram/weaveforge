/**
 * Grid packing for the dashboard: pull cards up, pack the mobile grid, and
 * close holes in a saved desktop layout, each card kept within its size limits.
 * Pure geometry, no storage.
 */

import type { DashboardLayoutItem } from "@weaveforge/core";

import { getCardDef } from "./card-registry";

/** Min/max for a card on a given column count (mobile vs desktop semantics differ). */
export function layoutFloors(def: ReturnType<typeof getCardDef>, cols: number) {
  const mobile = cols <= 4;
  return {
    minW: mobile ? def.minSize.w : Math.max(def.minSize.w, def.defaultSize.w),
    minH: mobile
      ? Math.max(def.minSize.h, def.defaultSizeSm.h)
      : Math.max(def.minSize.h, def.defaultSize.h),
    maxW: Math.min(def.maxSize.w, cols),
    maxH: def.maxSize.h,
  };
}

export function normalizeLayoutItem(
  item: DashboardLayoutItem,
  cols = 12,
): DashboardLayoutItem {
  const def = getCardDef(item.type);
  const { minW, minH, maxW, maxH } = layoutFloors(def, cols);
  const w = Math.max(minW, Math.min(maxW, item.w));
  const h = Math.max(minH, Math.min(maxH, item.h));
  return {
    ...item,
    w,
    h,
    x: Math.max(0, Math.min(item.x, cols - w)),
  };
}

function collides(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  if (a.x + a.w <= b.x) return false;
  if (a.x >= b.x + b.w) return false;
  if (a.y + a.h <= b.y) return false;
  if (a.y >= b.y + b.h) return false;
  return true;
}

/** Pack items upward with no vertical gaps (react-grid-layout compact). */
export function compactLayoutVertical(
  items: readonly DashboardLayoutItem[],
  cols: number,
): DashboardLayoutItem[] {
  const sorted = [...items].sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
  const compacted: DashboardLayoutItem[] = [];

  for (const item of sorted) {
    const next = {
      ...item,
      x: Math.max(0, Math.min(item.x, cols - item.w)),
    };
    let y = 0;
    while (true) {
      const probe = { ...next, y };
      const hit = compacted.find((p) => collides(probe, p));
      if (!hit) {
        next.y = y;
        break;
      }
      y = hit.y + hit.h;
    }
    compacted.push(next);
  }
  return compacted;
}

/** Snap mobile card width to half (2) or full (4) columns. */
function snapSmWidth(w: number): number {
  const clamped = Math.max(2, Math.min(4, w));
  return clamped >= 3 ? 4 : 2;
}

function fitsAt(
  item: { x: number; y: number; w: number; h: number },
  placed: readonly { x: number; y: number; w: number; h: number }[],
): boolean {
  return !placed.some((p) => collides(item, p));
}

/** Pack mobile cards into a tight 2- or 4-column grid (row-major, no gaps). */
export function packSmLayout(items: readonly DashboardLayoutItem[]): DashboardLayoutItem[] {
  const adjusted = items.map((it) => {
    const normalized = normalizeLayoutItem(it, 4);
    const w = snapSmWidth(normalized.w);
    return { ...normalized, w };
  });
  const sorted = [...adjusted].sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
  const placed: DashboardLayoutItem[] = [];

  for (const item of sorted) {
    const xs = item.w >= 4 ? [0] : [0, 2];
    let found: { x: number; y: number } | null = null;
    for (let y = 0; y < 200 && !found; y++) {
      for (const x of xs) {
        if (x + item.w > 4) continue;
        const probe = { ...item, x, y };
        if (fitsAt(probe, placed)) {
          found = { x, y };
          break;
        }
      }
    }
    const fallbackY = placed.reduce((m, p) => Math.max(m, p.y + p.h), 0);
    placed.push({
      ...item,
      x: found?.x ?? 0,
      y: found?.y ?? fallbackY,
    });
  }
  return placed;
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
  const sorted = items
    .map((it) => normalizeLayoutItem(it, cols))
    .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
  const placed: DashboardLayoutItem[] = [];
  for (const it of sorted) {
    let spot: { x: number; y: number } | null = null;
    for (let y = 0; !spot && y < 400; y++) {
      for (let x = 0; x + it.w <= cols; x++) {
        if (fitsAt({ ...it, x, y }, placed)) {
          spot = { x, y };
          break;
        }
      }
    }
    placed.push({ ...it, ...(spot ?? { x: 0, y: placed.reduce((m, p) => Math.max(m, p.y + p.h), 0) }) });
  }
  // Widen right to left, so the rightmost card of a row takes the free columns.
  const byRight = [...placed].sort((a, b) => b.x - a.x);
  for (const it of byRight) {
    const { maxW } = layoutFloors(getCardDef(it.type), cols);
    while (
      it.x + it.w < cols &&
      it.w < maxW &&
      fitsAt({ x: it.x + it.w, y: it.y, w: 1, h: it.h }, placed.filter((p) => p !== it))
    ) {
      it.w += 1;
    }
  }
  // A short card beside a tall one leaves a hole under it; it grows into the
  // hole when that row is still inside the grid (another card spans it).
  for (const it of placed) {
    const { maxH } = layoutFloors(getCardDef(it.type), cols);
    const others = placed.filter((p) => p !== it);
    while (
      it.h < maxH &&
      others.some((p) => p.y <= it.y + it.h && p.y + p.h > it.y + it.h) &&
      fitsAt({ x: it.x, y: it.y + it.h, w: it.w, h: 1 }, others)
    ) {
      it.h += 1;
    }
  }
  return placed.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
}
