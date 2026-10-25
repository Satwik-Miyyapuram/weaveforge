import { useCallback, useEffect, useRef, useState } from "react";
import { getContainer } from "@/bootstrap";
import { useProject } from "@/features/projects";
import { formatError } from "@/lib/format-error";
import { registerDashboardUiCacheClear } from "@/lib/cache/clear-session-caches";
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

/** `getPorts` is the container's by default; tests pass their own. */
export function useDashboardStats(
  cardTypes: readonly DashboardCardType[],
  supervisees: readonly Member[],
  getPorts: () => DashboardStatsPorts = portsFromContainer,
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

  // The key of the newest load. An older one that answers late — a project
  // switched away from mid-load — must not paint over the newer one.
  const latestKey = useRef(cacheKey);
  // Read through a ref, not a dependency: a minified build inlines the default
  // into the parameter list, so each render passes a new function, and as a
  // dependency it reloaded the stats on every render, forever.
  const getPortsRef = useRef(getPorts);
  getPortsRef.current = getPorts;

  const loadStats = useCallback(async () => {
    latestKey.current = cacheKey;
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
      const result = await loadDashboardStats(getPortsRef.current(), {
        cardTypes,
        supervisees,
      });
      if (latestKey.current !== cacheKey) return;
      const entry: StatsCacheEntry = {
        stats: result.stats,
        supervision: result.supervision,
      };
      // A partial result is shown but not kept: the next visit should try again
      // rather than paint a failure from the cache as if it were the data.
      if (!result.criticalError && !result.supervisionError) statsCache.set(cacheKey, entry);
      setStats(entry.stats);
      setSupervision(entry.supervision);
      if (result.criticalError) {
        setStatsError(formatError(result.criticalError));
      } else if (result.supervisionError) {
        setStatsError(formatError(result.supervisionError));
      }
    } catch (err) {
      if (latestKey.current === cacheKey) setStatsError(formatError(err));
    } finally {
      if (latestKey.current === cacheKey) setStatsLoading(false);
    }
  }, [cacheKey, cardTypes, supervisees, projectId]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  return { stats, supervision, statsLoading, statsError, reloadStats: loadStats };
}
