import { DASHBOARD_CARD_TYPES, type DashboardLayout, type DashboardLayoutItem } from "./dashboard-layout.js";

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

/**
 * Parse layout JSON from persistence (no compaction). Returns null only when
 * `lg`/`sm` are not arrays. An invalid item, such as a card type this client
 * does not know, is dropped on its own so the rest of the layout survives
 * (35-11).
 */
export function parseDashboardLayout(raw: unknown): DashboardLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { lg?: unknown; sm?: unknown };
  if (!Array.isArray(o.lg) || !Array.isArray(o.sm)) return null;
  return { lg: o.lg.filter(isLayoutItem), sm: o.sm.filter(isLayoutItem) };
}
