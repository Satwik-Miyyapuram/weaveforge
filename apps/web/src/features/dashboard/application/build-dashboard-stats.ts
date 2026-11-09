import type {
  Experiment,
  LogEntry,
  Milestone,
  Paper,
  PaperRelation,
  ReportSection,
  TagWithPaperCount,
} from "@weaveforge/core";
import { localIsoDate } from "@weaveforge/core";
import { readyCore, typedCore } from "@/lib/rust-core";

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

/** How many of the items are done, and that as a whole percentage. */
function progressOf<T>(items: readonly T[], isDone: (item: T) => boolean): ProgressStat {
  const total = items.length;
  const done = items.filter(isDone).length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function readingProgress(papers: readonly Paper[]): ProgressStat {
  return progressOf(papers, (p) => p.status === "read");
}

function reportProgress(sections: readonly ReportSection[]): ProgressStat {
  return progressOf(sections, (s) => s.status === "done");
}

function planProgress(milestones: readonly Milestone[]): ProgressStat {
  return progressOf(milestones, (m) => m.status === "done");
}

function experimentsSummary(experiments: readonly Experiment[]): ExperimentsStat {
  const running = experiments.filter((e) => e.status === "running").length;
  return { ...progressOf(experiments, (e) => e.status === "done"), running };
}

export function needsAttention(
  papers: readonly Paper[],
  milestones: readonly Milestone[],
  experiments: readonly Experiment[],
  today = localIsoDate(),
): AttentionItem[] {
  return [...typedCore().dashboardNeedsAttention(papers, milestones, experiments, today)];
}

function recentLogEntries(
  entries: readonly LogEntry[],
  limit = 5,
): RecentLogItem[] {
  const sorted = [...entries].sort(
    (a, b) => b.entryDate.localeCompare(a.entryDate) || b.createdAt.localeCompare(a.createdAt),
  );
  return sorted.slice(0, limit).map((e) => ({
    id: e.id,
    date: e.entryDate,
    // The same plain-text preview the note and paper cards show: raw `##` and
    // `**` in a one-line preview read as corruption, not as markdown.
    preview: readyCore().cardSnippet(e.body, 80),
    href: "/log",
  }));
}

export function librarySnapshot(
  paperCount: number,
  edgeCount: number,
  listCount: number,
): LibrarySnapshot {
  return {
    papers: paperCount,
    edges: edgeCount,
    lists: listCount,
    href: "/graph",
  };
}

function topTags(tags: readonly TagWithPaperCount[], limit = 3) {
  return [...typedCore().dashboardTopTags(tags, limit)];
}

export function buildDashboardStats(input: {
  papers: readonly Paper[];
  sections: readonly ReportSection[];
  milestones: readonly Milestone[];
  experiments: readonly Experiment[];
  logEntries: readonly LogEntry[];
  relations: readonly PaperRelation[];
  listCount: number;
  tags: readonly TagWithPaperCount[];
}): DashboardStats {
  return {
    reading: readingProgress(input.papers),
    report: reportProgress(input.sections),
    plan: planProgress(input.milestones),
    experiments: experimentsSummary(input.experiments),
    attention: needsAttention(input.papers, input.milestones, input.experiments),
    recentLog: recentLogEntries(input.logEntries),
    library: librarySnapshot(
      input.papers.length,
      input.relations.length,
      input.listCount,
    ),
    topTags: topTags(input.tags),
  };
}
