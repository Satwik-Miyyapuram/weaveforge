/**
 * Dashboard grid layout algorithms and presets (pure, no React).
 */

import type {
  DashboardCardType,
  DashboardLayout,
  DashboardLayoutItem,
} from "@weaveforge/core";
import { parseDashboardLayout as parseDashboardLayoutCore } from "@weaveforge/core";

import { removeStored } from "@/lib/safe-storage";

import { getCardDef } from "./card-registry";
import {
  compactLayoutVertical,
  layoutFloors,
  normalizeLayoutItem,
  normalizeSmLayout,
  packSmLayout,
} from "./dashboard-layout-packing";

export {
  closeLayoutGaps,
  compactLayoutVertical,
  layoutFloors,
  normalizeLayoutItem,
  normalizeSmLayout,
} from "./dashboard-layout-packing";

export type { DashboardCardType, DashboardLayout, DashboardLayoutItem };

export function layoutCacheKey(projectId: string, supervisorLayout: boolean): string {
  return `${projectId}:${supervisorLayout ? "supervisor" : "student"}`;
}

function layoutStorageKey(projectId: string): string {
  return `thesis.dashboard.layout.${projectId}`;
}

/** @deprecated Layout is stored in the database; clear any legacy localStorage entry. */
export function clearLegacyLayoutStorage(projectId: string): void {
  removeStored(layoutStorageKey(projectId));
}

function newCardId(): string {
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
    // Attention sits beside the library rather than across the whole row: a
    // short list stretched over twelve columns read as mostly empty space, and
    // the old 8+4 row below it left a one-row hole under the library tile.
    item("attention", "needs-attention", 0, 2, 8, 3),
    item("library", "library-snapshot", 8, 2, 4, 3),
    item("log", "recent-log", 0, 5, 12, 3),
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
    item("library", "library-snapshot", 0, 11, 4, 2),
  ];
}

/** Supervisor default — desktop. */
function supervisorDefaultLg(): DashboardLayoutItem[] {
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
function supervisorDefaultSm(): DashboardLayoutItem[] {
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

/**
 * The layout a dashboard opens with. A saved layout is the user's: a supervisor
 * card they removed stays removed (35-12). Only a fresh supervisor layout gets
 * the supervisor cards merged in.
 */
export function initialDashboardLayout(
  stored: DashboardLayout | null,
  supervisor: boolean,
): DashboardLayout {
  if (stored) return finalizeDashboardLayout(stored);
  const base = defaultLayout(supervisor);
  return finalizeDashboardLayout(supervisor ? mergeSupervisorCardsIfMissing(base) : base);
}

/** Append a new card at the bottom of the grid. */
function appendCard(
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

function normalizeLayout(layout: DashboardLayout): DashboardLayout {
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
