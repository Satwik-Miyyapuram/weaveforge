import { useCallback, useEffect, useState } from "react";
import { getContainer } from "@/bootstrap";
import { useProject } from "@/features/projects";
import { formatError } from "@/lib/format-error";
import { registerDashboardUiCacheClear } from "@/lib/clear-session-caches";
import type { DashboardCardType, Member } from "@weaveforge/core";

import { buildDashboardStats, type DashboardStats } from "../application/build-dashboard-stats";
import {
  loadDashboardStats,
  type DashboardStatsPorts,
} from "../application/load-dashboard-stats";
import type { SupervisionStats } from "../application/build-supervision-stats";

const EMPTY_STATS = buildDashboardStats({
  papers: [],
  sections: [],
  milestones: [],
  experiments: [],
  logEntries: [],
  relations: [],
  listCount: 0,
  tags: [],
});

type StatsCacheEntry = {
  stats: DashboardStats;
  supervision: SupervisionStats | null;
};

const statsCache = new Map<string, StatsCacheEntry>();
registerDashboardUiCacheClear(() => statsCache.clear());

function statsCacheKey(
  projectId: string | null,
  cardTypes: readonly DashboardCardType[],
  supervisees: readonly Member[],
): string {
  const cards = [...cardTypes].sort().join(",");
  const people = supervisees.map((m) => m.id).sort().join(",");
  return `${projectId ?? "-"}|${cards}|${people}`;
}

function portsFromContainer(): DashboardStatsPorts {
  return getContainer().dashboard.statsPorts();
}

export function useDashboardStats(
  cardTypes: readonly DashboardCardType[],
  supervisees: readonly Member[],
) {
  const { current: project } = useProject();
  const projectId = project?.id ?? null;
  const cacheKey = statsCacheKey(projectId, cardTypes, supervisees);
  const cached = statsCache.get(cacheKey);

  const [statsLoading, setStatsLoading] = useState(() => cached == null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [stats, setStats] = useState<DashboardStats>(() => cached?.stats ?? EMPTY_STATS);
  const [supervision, setSupervision] = useState<SupervisionStats | null>(
    () => cached?.supervision ?? null,
  );

  const loadStats = useCallback(async () => {
    if (!projectId) {
      setStats(EMPTY_STATS);
      setSupervision(null);
      setStatsLoading(false);
      setStatsError(null);
      return;
    }
    const hit = statsCache.get(cacheKey);
    if (hit) {
      setStats(hit.stats);
      setSupervision(hit.supervision);
      setStatsLoading(false);
    } else {
      setStatsLoading(true);
    }
    setStatsError(null);
    try {
      const result = await loadDashboardStats(portsFromContainer(), {
        cardTypes,
        supervisees,
      });
      const entry: StatsCacheEntry = {
        stats: result.stats,
        supervision: result.supervision,
      };
      statsCache.set(cacheKey, entry);
      setStats(entry.stats);
      setSupervision(entry.supervision);
      if (result.criticalError) {
        setStatsError(formatError(result.criticalError));
      } else if (result.supervisionError) {
        setStatsError(formatError(result.supervisionError));
      }
    } catch (err) {
      setStatsError(formatError(err));
    } finally {
      setStatsLoading(false);
    }
  }, [cacheKey, cardTypes, supervisees, projectId]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  return { stats, supervision, statsLoading, statsError, reloadStats: loadStats };
}
