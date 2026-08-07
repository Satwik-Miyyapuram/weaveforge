/**
 * Dashboard grid layout algorithms and presets (pure, no React).
 */

import type {
  DashboardCardType,
  DashboardLayout,
  DashboardLayoutItem,
} from "@weaveforge/core";
import { parseDashboardLayout as parseDashboardLayoutCore } from "@weaveforge/core";

import { CARD_REGISTRY, getCardDef } from "./card-registry";

export type { DashboardCardType, DashboardLayout, DashboardLayoutItem };

export function layoutCacheKey(projectId: string, supervisorLayout: boolean): string {
  return `${projectId}:${supervisorLayout ? "supervisor" : "student"}`;
}

export function layoutStorageKey(projectId: string): string {
  return `thesis.dashboard.layout.${projectId}`;
}

/** @deprecated Layout is stored in Supabase; clear any legacy localStorage entry. */
export function clearLegacyLayoutStorage(projectId: string): void {
  try {
    localStorage.removeItem(layoutStorageKey(projectId));
  } catch {
    /* ignore */
  }
}

export function newCardId(): string {
  return `card-${crypto.randomUUID().slice(0, 8)}`;
}

function item(
  id: string,
  type: DashboardCardType,
  x: number,
  y: number,
  w: number,
  h: number,
  config?: Record<string, unknown>,
): DashboardLayoutItem {
  return { id, type, x, y, w, h, config };
}

/** Student default — desktop (12 cols). */
export function studentDefaultLg(): DashboardLayoutItem[] {
  return [
    item("reading", "reading-progress", 0, 0, 3, 2),
    item("report", "report-progress", 3, 0, 3, 2),
    item("plan", "plan-progress", 6, 0, 3, 2),
    item("experiments", "experiments-summary", 9, 0, 3, 2),
    item("attention", "needs-attention", 0, 2, 12, 3),
    item("log", "recent-log", 0, 5, 8, 3),
    item("library", "library-snapshot", 8, 5, 4, 2),
  ];
}

/** Student default — mobile (4 cols, 2-col stat tiles). */
export function studentDefaultSm(): DashboardLayoutItem[] {
  return [
    item("reading", "reading-progress", 0, 0, 2, 2),
    item("report", "report-progress", 2, 0, 2, 2),
    item("plan", "plan-progress", 0, 2, 2, 2),
    item("experiments", "experiments-summary", 2, 2, 2, 2),
    item("attention", "needs-attention", 0, 4, 4, 3),
    item("log", "recent-log", 0, 7, 4, 4),
    item("library", "library-snapshot", 0, 11, 2, 2),
  ];
}

/** Supervisor default — desktop. */
export function supervisorDefaultLg(): DashboardLayoutItem[] {
  return [
    item("team", "team-roster", 0, 0, 12, 4),
    item("team-attn", "team-attention", 0, 4, 12, 3),
    item("reading", "reading-progress", 0, 7, 3, 2),
    item("report", "report-progress", 3, 7, 3, 2),
    item("plan", "plan-progress", 6, 7, 3, 2),
    item("experiments", "experiments-summary", 9, 7, 3, 2),
    item("log", "recent-log", 0, 9, 12, 3),
  ];
}

/** Supervisor default — mobile. */
export function supervisorDefaultSm(): DashboardLayoutItem[] {
  return [
    item("team", "team-roster", 0, 0, 4, 5),
    item("team-attn", "team-attention", 0, 5, 4, 4),
    item("reading", "reading-progress", 0, 9, 2, 2),
    item("report", "report-progress", 2, 9, 2, 2),
    item("plan", "plan-progress", 0, 11, 2, 2),
    item("experiments", "experiments-summary", 2, 11, 2, 2),
    item("log", "recent-log", 0, 13, 4, 4),
  ];
}

export function defaultLayout(supervisor: boolean): DashboardLayout {
  return supervisor
    ? { lg: supervisorDefaultLg(), sm: supervisorDefaultSm() }
    : { lg: studentDefaultLg(), sm: studentDefaultSm() };
}

const SUPERVISOR_ONLY_TYPES: DashboardCardType[] = [
  "team-roster",
  "team-attention",
  "supervisee-snapshot",
];

/** Add missing supervisor cards without removing user customizations. */
export function mergeSupervisorCardsIfMissing(layout: DashboardLayout): DashboardLayout {
  const present = new Set(layout.lg.map((c) => c.type));
  let next = layout;
  for (const type of SUPERVISOR_ONLY_TYPES) {
    if (present.has(type)) continue;
    next = appendCardPair(next, type);
  }
  return next === layout ? layout : finalizeDashboardLayout(next);
}

/** Append a new card at the bottom of the grid. */
export function appendCard(
  items: DashboardLayoutItem[],
  type: DashboardCardType,
  w: number,
  h: number,
  cols: number,
  id = newCardId(),
): DashboardLayoutItem[] {
  const maxY = items.reduce((m, it) => Math.max(m, it.y + it.h), 0);
  return [...items, { id, type, x: 0, y: maxY, w: Math.min(w, cols), h }];
}

/** Append a card to both breakpoints with a shared id. */
export function appendCardPair(layout: DashboardLayout, type: DashboardCardType): DashboardLayout {
  const id = newCardId();
  const def = getCardDef(type);
  return finalizeDashboardLayout({
    lg: appendCard(layout.lg, type, def.defaultSize.w, def.defaultSize.h, 12, id),
    sm: appendCard(layout.sm, type, def.defaultSizeSm.w, def.defaultSizeSm.h, 4, id),
  });
}

/** Repair LG/SM id drift; LG is canonical. */
export function syncDashboardLayouts(layout: DashboardLayout): DashboardLayout {
  const lgIds = new Set(layout.lg.map((c) => c.id));
  const smIds = new Set(layout.sm.map((c) => c.id));
  if (lgIds.size === smIds.size && [...lgIds].every((id) => smIds.has(id))) {
    return layout;
  }
  const smById = new Map(layout.sm.map((c) => [c.id, c]));
  const syncedSm = layout.lg.map((lgItem) => {
    const smItem = smById.get(lgItem.id);
    if (smItem) return smItem;
    const def = getCardDef(lgItem.type);
    return {
      ...lgItem,
      x: 0,
      y: 0,
      w: def.defaultSizeSm.w,
      h: def.defaultSizeSm.h,
    };
  });
  return finalizeDashboardLayout({ lg: layout.lg, sm: syncedSm });
}

export function mergeRglPositions(
  items: DashboardLayoutItem[],
  rgl: readonly { i: string; x: number; y: number; w: number; h: number }[],
  cols = 12,
): DashboardLayoutItem[] {
  const byId = new Map(rgl.map((r) => [r.i, r]));
  return items.map((it) => {
    const pos = byId.get(it.id);
    const merged = pos ? { ...it, x: pos.x, y: pos.y, w: pos.w, h: pos.h } : it;
    return normalizeLayoutItem(merged, cols);
  });
}

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

export function normalizeLayout(layout: DashboardLayout): DashboardLayout {
  return {
    lg: layout.lg.map((it) => normalizeLayoutItem(it, 12)),
    sm: layout.sm.map((it) => normalizeLayoutItem(it, 4)),
  };
}

export function lgLayoutNeedsRepair(items: readonly DashboardLayoutItem[]): boolean {
  return items.some((it) => {
    const { minW } = layoutFloors(getCardDef(it.type), 12);
    return it.w < minW;
  });
}

export function layoutSignature(items: readonly DashboardLayoutItem[]): string {
  return items.map((it) => `${it.id}:${it.x},${it.y},${it.w},${it.h}`).join("|");
}

export function smLayoutNeedsRepack(
  items: readonly DashboardLayoutItem[],
): boolean {
  return layoutSignature(items) !== layoutSignature(packSmLayout(items));
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

export function finalizeDashboardLayout(layout: DashboardLayout): DashboardLayout {
  const normalized = normalizeLayout(layout);
  return {
    lg: compactLayoutVertical(normalized.lg, 12),
    sm: normalizeSmLayout(normalized.sm),
  };
}

/** Parse layout JSON and apply compaction defaults for the active breakpoints. */
export function parseDashboardLayout(raw: unknown): DashboardLayout | null {
  const parsed = parseDashboardLayoutCore(raw);
  return parsed ? finalizeDashboardLayout(parsed) : null;
}
