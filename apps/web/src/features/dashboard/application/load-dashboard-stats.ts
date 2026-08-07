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
import { fetchSuperviseeMilestonesAndLogs } from "./fetch-supervisee-data";

/** Ports the dashboard stats loader depends on (DIP). */
export interface DashboardStatsPorts {
  prefetch(): Promise<void>;
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
  if (need("tags")) {
    fetches.push(ports.listTags().then((v) => { tags = v; }).catch(() => undefined));
  }

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

  if (need("supervision") && input.supervisees.length > 0) {
    const { milestonesByMember, logsByMember, error } = await ports.fetchSuperviseeData(
      input.supervisees,
    );
    supervisionError = error;
    supervision = buildSupervisionStats(
      input.supervisees,
      milestonesByMember,
      logsByMember,
    );
  }

  return { stats, supervision, criticalError, supervisionError };
}
