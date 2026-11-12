import { readyCore, typedCore } from "@/lib/rust-core";
import { removeStored } from "@/lib/safe-storage";
import {
  type DashboardCardType,
  type DashboardLayout,
  type DashboardLayoutItem,
  type Experiment,
  type ISupervisionRepository,
  localIsoDate,
  type LogEntry,
  type Member,
  type Milestone,
  type Paper,
  type PaperRelation,
  type ReadingListTreeNode,
  type ReportSection,
  type Role,
  type TagWithPaperCount,
} from "@weaveforge/core";

// --- build-dashboard-stats ---
export interface ProgressStat {
  done: number;
  total: number;
  pct: number;
}

interface ExperimentsStat extends ProgressStat {
  running: number;
}

export interface AttentionItem {
  label: string;
  href: string;
}

interface RecentLogItem {
  id: string;
  date: string;
  preview: string;
  href: string;
}

export interface LibrarySnapshot {
  papers: number;
  edges: number;
  lists: number;
  href: string;
}

export interface DashboardStats {
  reading: ProgressStat;
  report: ProgressStat;
  plan: ProgressStat;
  experiments: ExperimentsStat;
  attention: AttentionItem[];
  recentLog: RecentLogItem[];
  library: LibrarySnapshot;
  topTags: { name: string; count: number }[];
}

/**
 * The dashboard stats, computed by Rust (`dashboard::stats::build_dashboard_stats`).
 * `today` (`yyyy-mm-dd`) decides overdue and due-soon milestones; it defaults to the local day.
 */
export function buildDashboardStats(
  input: {
    papers: readonly Paper[];
    sections: readonly ReportSection[];
    milestones: readonly Milestone[];
    experiments: readonly Experiment[];
    logEntries: readonly LogEntry[];
    relations: readonly PaperRelation[];
    listCount: number;
    tags: readonly TagWithPaperCount[];
  },
  today = localIsoDate(),
): DashboardStats {
  return typedCore().dashboardBuildStats(
    {
      papers: input.papers,
      sections: input.sections,
      milestones: input.milestones,
      experiments: input.experiments,
      logEntries: input.logEntries,
      relationCount: input.relations.length,
      listCount: input.listCount,
      tags: input.tags,
    },
    today,
  ) as DashboardStats;
}

// --- build-supervision-stats ---
export interface SuperviseeSummary {
  member: Member;
  milestonesTotal: number;
  milestonesDone: number;
  blocked: number;
  upcomingDue: number;
  lastLogDate: string | null;
  statusLabel: string;
}

export interface TeamAttentionItem {
  memberId: string;
  memberName: string;
  label: string;
  href: string;
}

export interface SupervisionStats {
  roster: SuperviseeSummary[];
  teamAttention: TeamAttentionItem[];
}

export function summarizeSupervisee(
  member: Member,
  milestones: readonly Milestone[],
  logs: readonly LogEntry[],
  today = localIsoDate(),
): SuperviseeSummary {
  return {
    member,
    ...(typedCore().dashboardSuperviseeCounts(milestones, logs, today) as Omit<SuperviseeSummary, "member">),
  };
}

export function teamAttentionItems(
  summaries: readonly SuperviseeSummary[],
  milestonesByMember: ReadonlyMap<string, readonly Milestone[]>,
  today = localIsoDate(),
): TeamAttentionItem[] {
  const supervisees = summaries.map((s) => ({
    member: s.member,
    milestones: milestonesByMember.get(s.member.id) ?? [],
  }));
  return typedCore().dashboardTeamAttention(supervisees, today) as TeamAttentionItem[];
}

export function buildSupervisionStats(
  supervisees: readonly Member[],
  milestonesByMember: ReadonlyMap<string, readonly Milestone[]>,
  logsByMember: ReadonlyMap<string, readonly LogEntry[]>,
): SupervisionStats {
  const roster = supervisees.map((m) =>
    summarizeSupervisee(
      m,
      milestonesByMember.get(m.id) ?? [],
      logsByMember.get(m.id) ?? [],
    ),
  );
  return {
    roster,
    teamAttention: teamAttentionItems(roster, milestonesByMember),
  };
}

// --- card-registry ---
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

export interface GridSize {
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
  /** A list that takes the rows its content needs while viewed (DA-128). */
  fitContent?: boolean;
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
    // A log row (date over preview) is taller than a grid row.
    fitContent: true,
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
    fitContent: true,
  },
  {
    type: "team-attention",
    label: "Team attention",
    group: "Team",
    deps: ["supervision"],
    minRole: "phd",
    ...PANEL,
    fitContent: true,
  },
  {
    type: "supervisee-snapshot",
    label: "Student snapshot",
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
  const core = readyCore();
  const rank = role ? core.roleRank(role) : 0;
  return CARD_REGISTRY.filter((c) => {
    if (!c.minRole) return true;
    const min = core.roleRank(c.minRole);
    return rank !== undefined && min !== undefined && rank >= min;
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

/** Largest height of each list card that fits its content; the Rust fit takes this map as data. */
export const FIT_MAX_HEIGHTS: Readonly<Record<string, number>> = Object.fromEntries(
  CARD_REGISTRY.filter((c) => c.fitContent).map((c) => [c.type, c.maxSize.h]),
);

// --- dashboard-layout-packing ---
/**
 * Grid packing for the dashboard: pull cards up, pack the mobile grid, and
 * close holes in a saved desktop layout, each card kept within its size limits.
 * The geometry runs in Rust (wf-core `dashboard::packing`); this module supplies
 * each card's size limits from the card registry. Pure, no storage.
 */
type CardSizeDef = (typeof CARD_REGISTRY)[number];

/** Every card's size limits, as the Rust packing and layout functions take them. */
export const CARD_LIMITS = CARD_REGISTRY.map((def) => ({
  type: def.type,
  minSize: def.minSize,
  maxSize: def.maxSize,
  defaultSize: def.defaultSize,
  defaultSizeSm: def.defaultSizeSm,
}));

/** Min/max for a card on a given column count (mobile vs desktop semantics differ). */
export function layoutFloors(def: CardSizeDef, cols: number) {
  return readyCore().dashboardLayoutFloors(
    {
      type: def.type,
      minSize: def.minSize,
      maxSize: def.maxSize,
      defaultSize: def.defaultSize,
      defaultSizeSm: def.defaultSizeSm,
    },
    cols,
  );
}

export function normalizeLayoutItem(
  item: DashboardLayoutItem,
  cols = 12,
): DashboardLayoutItem {
  return readyCore().dashboardNormalizeItem(item, CARD_LIMITS, cols) as DashboardLayoutItem;
}

/** Pack items upward with no vertical gaps (react-grid-layout compact). */
export function compactLayoutVertical(
  items: readonly DashboardLayoutItem[],
  cols: number,
): DashboardLayoutItem[] {
  return readyCore().dashboardCompactVertical(items, cols) as DashboardLayoutItem[];
}

/** Pack mobile cards into a tight 4-column grid (row-major, no gaps). */
export function packSmLayout(items: readonly DashboardLayoutItem[]): DashboardLayoutItem[] {
  return readyCore().dashboardPackSm(items, CARD_LIMITS) as DashboardLayoutItem[];
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
  return readyCore().dashboardCloseGaps(items, CARD_LIMITS, cols) as DashboardLayoutItem[];
}

// --- dashboard-layout ---
/**
 * Dashboard grid layout: presets and the layout rules (Rust `dashboard::layout`, called
 * through the core with each card's size limits). This module keeps the id minting and
 * the browser storage; it has no React.
 */
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

// --- fetch-supervisee-data ---
export async function fetchSuperviseeMilestonesAndLogs(
  repo: ISupervisionRepository,
  supervisees: readonly Member[],
): Promise<{
  milestonesByMember: Map<string, Milestone[]>;
  logsByMember: Map<string, LogEntry[]>;
  error: unknown | null;
}> {
  // Two queries for the whole team, not two per supervisee: a supervisor with
  // six students was making twelve.
  const ids = supervisees.map((member) => member.id);
  const [milestones, logs] = await Promise.allSettled([
    repo.listMilestonesFor(ids),
    repo.listLogsFor(ids),
  ]);
  const failure = [milestones, logs].find((r) => r.status === "rejected");
  return {
    milestonesByMember: milestones.status === "fulfilled" ? milestones.value : new Map(),
    logsByMember: logs.status === "fulfilled" ? logs.value : new Map(),
    error: failure?.status === "rejected" ? failure.reason : null,
  };
}

// --- load-dashboard-stats ---
/** Ports the dashboard stats loader depends on (DIP). */
export interface DashboardStatsPorts {
  listPapers(): Promise<Paper[]>;
  listSections(): Promise<ReportSection[]>;
  listMilestones(): Promise<Milestone[]>;
  listExperiments(): Promise<Experiment[]>;
  listLogEntries(): Promise<LogEntry[]>;
  listRelations(): Promise<PaperRelation[]>;
  getReadingListTree(): Promise<ReadingListTreeNode[]>;
  listTags(): Promise<TagWithPaperCount[]>;
  fetchSuperviseeData(supervisees: readonly Member[]): Promise<{
    milestonesByMember: Map<string, Milestone[]>;
    logsByMember: Map<string, LogEntry[]>;
    error: unknown | null;
  }>;
}

export interface LoadDashboardStatsInput {
  cardTypes: readonly DashboardCardType[];
  supervisees: readonly Member[];
}

export interface LoadDashboardStatsResult {
  stats: DashboardStats;
  supervision: SupervisionStats | null;
  criticalError: unknown | null;
  supervisionError: unknown | null;
}

function resolveDeps(cardTypes: readonly DashboardCardType[]): Set<DashboardDataSource> {
  return cardTypes.length > 0
    ? dataSourcesForCardTypes(cardTypes)
    : new Set(ALL_DASHBOARD_DATA_SOURCES);
}

/** Pure orchestration: fetch only what visible cards need, then build stats. */
export async function loadDashboardStats(
  ports: DashboardStatsPorts,
  input: LoadDashboardStatsInput,
): Promise<LoadDashboardStatsResult> {
  const deps = resolveDeps(input.cardTypes);

  const need = (d: DashboardDataSource) => deps.has(d);

  const fetches: Promise<void>[] = [];
  let papers: Paper[] = [];
  let sections: ReportSection[] = [];
  let milestones: Milestone[] = [];
  let experiments: Experiment[] = [];
  let logEntries: LogEntry[] = [];
  let relations: PaperRelation[] = [];
  let listTree: ReadingListTreeNode[] = [];
  let tags: TagWithPaperCount[] = [];
  let criticalError: unknown | null = null;

  const track = (p: Promise<unknown>) =>
    fetches.push(
      p.catch((err) => {
        if (!criticalError) criticalError = err;
      }) as Promise<void>,
    );

  if (need("papers")) track(ports.listPapers().then((v) => { papers = v; }));
  if (need("sections")) track(ports.listSections().then((v) => { sections = v; }));
  if (need("milestones")) track(ports.listMilestones().then((v) => { milestones = v; }));
  if (need("experiments")) track(ports.listExperiments().then((v) => { experiments = v; }));
  if (need("log")) track(ports.listLogEntries().then((v) => { logEntries = v; }));
  if (need("relations")) track(ports.listRelations().then((v) => { relations = v; }));
  if (need("lists")) track(ports.getReadingListTree().then((v) => { listTree = v; }));
  if (need("tags")) track(ports.listTags().then((v) => { tags = v; }));

  // Started with the lists above rather than after them. A rejection is folded
  // into the result here so it is never left unhandled while the lists load.
  const superviseeFetch =
    need("supervision") && input.supervisees.length > 0
      ? ports.fetchSuperviseeData(input.supervisees).catch((error: unknown) => ({
          milestonesByMember: new Map<string, Milestone[]>(),
          logsByMember: new Map<string, LogEntry[]>(),
          error,
        }))
      : null;

  await Promise.all(fetches);

  const stats = buildDashboardStats({
    papers,
    sections,
    milestones,
    experiments,
    logEntries,
    relations,
    listCount: readyCore().collectListIds(listTree).length,
    tags,
  });

  let supervision: SupervisionStats | null = null;
  let supervisionError: unknown | null = null;

  if (superviseeFetch) {
    const { milestonesByMember, logsByMember, error } = await superviseeFetch;
    supervisionError = error;
    // Stats built from the empty maps of a failed fetch would show every
    // supervisee at zero; the cards already say "unavailable" for null.
    supervision = error
      ? null
      : buildSupervisionStats(input.supervisees, milestonesByMember, logsByMember);
  }

  return { stats, supervision, criticalError, supervisionError };
}
