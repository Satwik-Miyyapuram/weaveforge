import type { DashboardCardType, DashboardLayout, DashboardLayoutItem } from "./dashboard-layout.js";

/** All valid dashboard card type ids (keep in sync with web card registry). */
export const DASHBOARD_CARD_TYPES: readonly DashboardCardType[] = [
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

const CARD_TYPE_SET = new Set<string>(DASHBOARD_CARD_TYPES);

function isLayoutItem(v: unknown): v is DashboardLayoutItem {
  if (!v || typeof v !== "object") return false;
  const o = v as DashboardLayoutItem;
  return (
    typeof o.id === "string" &&
    CARD_TYPE_SET.has(o.type) &&
    typeof o.x === "number" &&
    typeof o.y === "number" &&
    typeof o.w === "number" &&
    typeof o.h === "number"
  );
}

/** Parse layout JSON from persistence; returns null if invalid (no compaction). */
export function parseDashboardLayout(raw: unknown): DashboardLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { lg?: unknown; sm?: unknown };
  if (!Array.isArray(o.lg) || !Array.isArray(o.sm)) return null;
  if (!o.lg.every(isLayoutItem) || !o.sm.every(isLayoutItem)) return null;
  return { lg: o.lg, sm: o.sm };
}
