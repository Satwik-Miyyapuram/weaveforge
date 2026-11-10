import { useCallback, useEffect, useRef, useState } from "react";
import { getContainer } from "@/bootstrap";
import { useProject } from "@/features/projects";
import { formatError } from "@/lib/format-error";
import { registerDashboardUiCacheClear } from "@/lib/cache/clear-session-caches";
import { readDeviceSnapshot, writeDeviceSnapshot } from "@/lib/cache/device-snapshot";
import type { DashboardCardType, Member } from "@weaveforge/core";

import { buildDashboardStats, type DashboardStats } from "../application/build-dashboard-stats";
import {
  loadDashboardStats,
  type DashboardStatsPorts,
} from "../application/load-dashboard-stats";
import type { SupervisionStats } from "../application/build-supervision-stats";

// Built on demand: the Rust core is not loaded when this module is imported.
const emptyStats = (): DashboardStats =>
  buildDashboardStats({
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

/** The device copy of a project's last good stats (desktop and phone only). */
function snapshotName(projectId: string): string {
  return `dashboard-stats:${projectId}`;
}

function readSnapshot(projectId: string | null): StatsCacheEntry | null {
  if (!projectId) return null;
  const saved = readDeviceSnapshot<StatsCacheEntry>(snapshotName(projectId));
  return saved && typeof saved.stats === "object" && saved.stats ? saved : null;
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
  // On a cold start the device copy paints until the database answers.
  const [saved] = useState(() => (cached ? null : readSnapshot(projectId)));
  const first = cached ?? saved;

  const [statsLoading, setStatsLoading] = useState(() => first == null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [stats, setStats] = useState<DashboardStats>(() => first?.stats ?? emptyStats());
  const [supervision, setSupervision] = useState<SupervisionStats | null>(
    () => first?.supervision ?? null,
  );
  /** True while the stats shown are the device copy, not a live load. */
  const [fromSnapshot, setFromSnapshot] = useState(() => cached == null && saved != null);

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
      setStats(emptyStats());
      setSupervision(null);
      setStatsLoading(false);
      setStatsError(null);
      setFromSnapshot(false);
      return;
    }
    const hit = statsCache.get(cacheKey);
    const copy = hit ? null : readSnapshot(projectId);
    if (hit ?? copy) {
      setStats((hit ?? copy)!.stats);
      setSupervision((hit ?? copy)!.supervision);
      setStatsLoading(false);
      setFromSnapshot(hit == null);
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
      if (!result.criticalError && !result.supervisionError) {
        statsCache.set(cacheKey, entry);
        writeDeviceSnapshot(snapshotName(projectId), entry);
      }
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
      if (latestKey.current === cacheKey) {
        setStatsLoading(false);
        setFromSnapshot(false);
      }
    }
  }, [cacheKey, cardTypes, supervisees, projectId]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  return { stats, supervision, statsLoading, statsError, fromSnapshot, reloadStats: loadStats };
}
