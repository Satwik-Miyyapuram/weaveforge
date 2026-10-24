/**
 * Dashboard grid layout types (pure domain, no I/O).
 */

/** Every dashboard card type id; the type below is derived from it (02-18). */
export const DASHBOARD_CARD_TYPES = [
  "reading-progress",
  "report-progress",
  "plan-progress",
  "experiments-summary",
  "needs-attention",
  "recent-log",
  "library-snapshot",
  "top-tags",
  "team-roster",
  "team-attention",
  "supervisee-snapshot",
] as const;

export type DashboardCardType = (typeof DASHBOARD_CARD_TYPES)[number];

export interface DashboardLayoutItem {
  id: string;
  type: DashboardCardType;
  x: number;
  y: number;
  w: number;
  h: number;
  config?: Record<string, unknown>;
}

export interface DashboardLayout {
  lg: DashboardLayoutItem[];
  sm: DashboardLayoutItem[];
}
