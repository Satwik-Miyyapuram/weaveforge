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

/** Student default, desktop (12 cols). Kept for the tests that read the preset directly. */
export function studentDefaultLg(): DashboardLayoutItem[] {
  return (readyCore().dashboardDefaultLayout(false) as DashboardLayout).lg;
}

/** Student default, mobile (4 cols). Kept for the tests that read the preset directly. */
export function studentDefaultSm(): DashboardLayoutItem[] {
  return (readyCore().dashboardDefaultLayout(false) as DashboardLayout).sm;
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
  if (stored) return readyCore().dashboardFinalizeLayout(stored, CARD_LIMITS) as DashboardLayout;
  const base = readyCore().dashboardDefaultLayout(supervisor) as DashboardLayout;
  return readyCore().dashboardFinalizeLayout(
    supervisor ? mergeSupervisorCardsIfMissing(base) : base,
    CARD_LIMITS,
  ) as DashboardLayout;
}

/** Append a card to both breakpoints with a shared id, then finalize. */
export function appendCardPair(layout: DashboardLayout, type: DashboardCardType): DashboardLayout {
  return readyCore().dashboardAppendCardPair(layout, type, newCardId(), CARD_LIMITS) as DashboardLayout;
}

/** Parse layout JSON and apply compaction defaults for the active breakpoints. */
export function parseDashboardLayout(raw: unknown): DashboardLayout | null {
  // Rust keeps only cards with a known card type.
  const parsed = readyCore().parseDashboardLayout(raw) as DashboardLayout | null;
  return parsed ? (readyCore().dashboardFinalizeLayout(parsed, CARD_LIMITS) as DashboardLayout) : null;
}
