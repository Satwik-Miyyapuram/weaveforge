/**
 * Dashboard grid layout: presets and the layout rules (Rust `dashboard::layout`, called
 * through the core with each card's size limits). This module keeps the id minting and
 * the browser storage; it has no React.
 */

import type {
  DashboardCardType,
  DashboardLayout,
  DashboardLayoutItem,
} from "@weaveforge/core";

import { removeStored } from "@/lib/safe-storage";
import { readyCore } from "@/lib/rust-core";

import { CARD_LIMITS } from "./dashboard-layout-packing";

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

/** The layout a new dashboard starts from: the supervisor or the student default. */
export function defaultLayout(supervisor: boolean): DashboardLayout {
  return readyCore().dashboardDefaultLayout(supervisor) as DashboardLayout;
}

/** Student default, desktop (12 cols). Kept for the tests that read the preset directly. */
export function studentDefaultLg(): DashboardLayoutItem[] {
  return defaultLayout(false).lg;
}

/** Student default, mobile (4 cols). Kept for the tests that read the preset directly. */
export function studentDefaultSm(): DashboardLayoutItem[] {
  return defaultLayout(false).sm;
}

/** Add missing supervisor cards without removing user customizations. */
export function mergeSupervisorCardsIfMissing(layout: DashboardLayout): DashboardLayout {
  // One id per supervisor-only card type; the core uses only the ones it appends.
  const ids = Array.from({ length: 3 }, newCardId);
  return readyCore().dashboardMergeSupervisorCards(layout, CARD_LIMITS, ids) as DashboardLayout;
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

/** Append a card to both breakpoints with a shared id, then finalize. */
export function appendCardPair(layout: DashboardLayout, type: DashboardCardType): DashboardLayout {
  return readyCore().dashboardAppendCardPair(layout, type, newCardId(), CARD_LIMITS) as DashboardLayout;
}

/** Repair LG/SM id drift; LG is canonical. */
export function syncDashboardLayouts(layout: DashboardLayout): DashboardLayout {
  return readyCore().dashboardSyncLayouts(layout, CARD_LIMITS) as DashboardLayout;
}

export function mergeRglPositions(
  items: DashboardLayoutItem[],
  rgl: readonly { i: string; x: number; y: number; w: number; h: number }[],
  cols = 12,
): DashboardLayoutItem[] {
  return readyCore().dashboardMergeRglPositions(items, rgl, CARD_LIMITS, cols) as DashboardLayoutItem[];
}

export function lgLayoutNeedsRepair(items: readonly DashboardLayoutItem[]): boolean {
  return readyCore().dashboardLgNeedsRepair(items, CARD_LIMITS);
}

export function layoutSignature(items: readonly DashboardLayoutItem[]): string {
  return readyCore().dashboardLayoutSignature(items);
}

export function smLayoutNeedsRepack(items: readonly DashboardLayoutItem[]): boolean {
  return readyCore().dashboardSmNeedsRepack(items, CARD_LIMITS);
}

export function finalizeDashboardLayout(layout: DashboardLayout): DashboardLayout {
  return readyCore().dashboardFinalizeLayout(layout, CARD_LIMITS) as DashboardLayout;
}

/** Parse layout JSON and apply compaction defaults for the active breakpoints. */
export function parseDashboardLayout(raw: unknown): DashboardLayout | null {
  // Rust keeps only cards with a known card type.
  const parsed = readyCore().parseDashboardLayout(raw) as DashboardLayout | null;
  return parsed ? finalizeDashboardLayout(parsed) : null;
}
