import type {
  DashboardCardType,
  Experiment,
  LogEntry,
  Member,
  Milestone,
  Paper,
  PaperRelation,
  ReadingListTreeNode,
  ReportSection,
  TagWithPaperCount,
} from "@weaveforge/core";

import {
  ALL_DASHBOARD_DATA_SOURCES,
  type DashboardDataSource,
  dataSourcesForCardTypes,
} from "./card-registry";
import { buildDashboardStats, type DashboardStats } from "./build-dashboard-stats";
import {
  buildSupervisionStats,
  type SupervisionStats,
} from "./build-supervision-stats";

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

function countLists(nodes: readonly ReadingListTreeNode[]): number {
  let n = 0;
  for (const node of nodes) {
    n += 1;
    n += countLists(node.children);
  }
  return n;
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
    listCount: countLists(listTree),
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
