/**
 * Dashboard grid layout types (pure domain, no I/O).
 */

export type DashboardCardType =
  | "reading-progress"
  | "report-progress"
  | "plan-progress"
  | "experiments-summary"
  | "needs-attention"
  | "recent-log"
  | "library-snapshot"
  | "top-tags"
  | "team-roster"
  | "team-attention"
  | "supervisee-snapshot";

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
