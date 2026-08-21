import type { DashboardCardType, Role } from "@weaveforge/core";
import { ROLE_RANK } from "@weaveforge/core";

/**
 * Card catalog (OCP). To add a card:
 * 1. Extend `DashboardCardType` in `@weaveforge/core`
 * 2. Add a `CardDef` entry below (with `deps`)
 * 3. Add one renderer in `ui/cards/card-renderers.tsx`
 */

export type DashboardDataSource =
  | "papers"
  | "sections"
  | "milestones"
  | "experiments"
  | "log"
  | "relations"
  | "lists"
  | "tags"
  | "supervision";

export const ALL_DASHBOARD_DATA_SOURCES: readonly DashboardDataSource[] = [
  "papers",
  "sections",
  "milestones",
  "experiments",
  "log",
  "relations",
  "lists",
  "tags",
  "supervision",
];

interface GridSize {
  w: number;
  h: number;
}

export interface CardDef {
  type: DashboardCardType;
  label: string;
  group: "Progress" | "Activity" | "Library" | "Team";
  /** Data sources required to render this card (ISP). */
  deps: readonly DashboardDataSource[];
  /** Compact stat tile layout (progress rings / counts). */
  isStat?: boolean;
  /** Omit = all roles. */
  minRole?: Role;
  defaultSize: GridSize;
  defaultSizeSm: GridSize;
  minSize: GridSize;
  maxSize: GridSize;
}

/* The three layouts every card is one of. Spelled out per card they read as
   fourteen independent decisions when they are really three, which hides the
   odd one out and makes "how big is a stat tile" a fourteen-line change. */
const STAT_TILE = {
  defaultSize: { w: 3, h: 2 },
  defaultSizeSm: { w: 2, h: 2 },
  minSize: { w: 2, h: 2 },
  maxSize: { w: 6, h: 3 },
} as const;

const PANEL = {
  defaultSize: { w: 6, h: 3 },
  defaultSizeSm: { w: 4, h: 3 },
  minSize: { w: 4, h: 3 },
  maxSize: { w: 12, h: 6 },
} as const;

const TALL_PANEL = {
  defaultSize: { w: 6, h: 4 },
  defaultSizeSm: { w: 4, h: 5 },
  minSize: { w: 4, h: 3 },
  maxSize: { w: 12, h: 6 },
} as const;

export const CARD_REGISTRY: readonly CardDef[] = [
  {
    type: "reading-progress",
    label: "Reading progress",
    group: "Progress",
    deps: ["papers"],
    isStat: true,
    ...STAT_TILE,
  },
  {
    type: "report-progress",
    label: "Report progress",
    group: "Progress",
    deps: ["sections"],
    isStat: true,
    ...STAT_TILE,
  },
  {
    type: "plan-progress",
    label: "Plan progress",
    group: "Progress",
    deps: ["milestones"],
    isStat: true,
    ...STAT_TILE,
  },
  {
    type: "experiments-summary",
    label: "Experiments",
    group: "Progress",
    deps: ["experiments"],
    isStat: true,
    ...STAT_TILE,
  },
  {
    type: "needs-attention",
    label: "Needs attention",
    group: "Activity",
    deps: ["papers", "milestones", "experiments"],
    ...PANEL,
  },
  {
    type: "recent-log",
    label: "Recent log",
    group: "Activity",
    deps: ["log"],
    defaultSize: { w: 6, h: 3 },
    defaultSizeSm: { w: 4, h: 4 },
    minSize: { w: 4, h: 3 },
    maxSize: { w: 12, h: 6 },
  },
  {
    type: "library-snapshot",
    label: "Library snapshot",
    group: "Library",
    deps: ["papers", "relations", "lists"],
    isStat: true,
    ...STAT_TILE,
  },
  {
    type: "top-tags",
    label: "Top tags",
    group: "Library",
    deps: ["tags"],
    defaultSize: { w: 4, h: 3 },
    defaultSizeSm: { w: 4, h: 3 },
    minSize: { w: 3, h: 3 },
    maxSize: { w: 12, h: 6 },
  },
  {
    type: "team-roster",
    label: "Team roster",
    group: "Team",
    deps: ["supervision"],
    minRole: "phd",
    ...TALL_PANEL,
  },
  {
    type: "team-attention",
    label: "Team attention",
    group: "Team",
    deps: ["supervision"],
    minRole: "phd",
    ...PANEL,
  },
  {
    type: "supervisee-snapshot",
    label: "Supervisee snapshot",
    group: "Team",
    deps: ["supervision"],
    minRole: "phd",
    ...TALL_PANEL,
  },
];

const byType = new Map(CARD_REGISTRY.map((c) => [c.type, c]));

export function getCardDef(type: DashboardCardType): CardDef {
  const def = byType.get(type);
  if (!def) throw new Error(`Unknown card type: ${type}`);
  return def;
}

export function cardsForRole(role: Role | null | undefined): CardDef[] {
  const rank = role ? ROLE_RANK[role] : 0;
  return CARD_REGISTRY.filter((c) => {
    if (!c.minRole) return true;
    return rank >= ROLE_RANK[c.minRole];
  });
}

export function isStatCard(type: DashboardCardType): boolean {
  return !!getCardDef(type).isStat;
}

/** Union of data sources required by the visible cards. */
export function dataSourcesForCardTypes(
  types: readonly DashboardCardType[],
): Set<DashboardDataSource> {
  const out = new Set<DashboardDataSource>();
  for (const type of types) {
    for (const dep of getCardDef(type).deps) out.add(dep);
  }
  return out;
}
