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
import { typedCore } from "@/lib/rust-core";

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
  return typedCore().dashboardBuildStats<DashboardStats>(
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
  );
}
