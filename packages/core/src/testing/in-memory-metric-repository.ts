import type {
  IMetricRepository,
  MetricPoint,
} from "../features/experiments/domain/metric-point.js";

/**
 * In-memory IMetricRepository. History is returned ordered by metric then step,
 * matching the `experiment_metrics_series_idx` order the Supabase adapter relies
 * on — so the shared contract suite passes against both (Liskov).
 */
export class InMemoryMetricRepository implements IMetricRepository {
  private points: MetricPoint[] = [];

  async append(points: MetricPoint[]): Promise<void> {
    this.points.push(...points.map((p) => ({ ...p })));
  }

  async history(experimentId: string, metric?: string): Promise<MetricPoint[]> {
    return this.points
      .filter((p) => p.experimentId === experimentId)
      .filter((p) => (metric ? p.metric === metric : true))
      .sort((a, b) => (a.metric === b.metric ? a.step - b.step : a.metric.localeCompare(b.metric)))
      .map((p) => ({ ...p }));
  }

  async latestActivityAt(experimentIds: readonly string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const ids = new Set(experimentIds);
    for (const p of this.points) {
      if (!ids.has(p.experimentId) || !p.wallTime) continue;
      const t = Date.parse(p.wallTime);
      if (!Number.isFinite(t)) continue;
      const prev = out.get(p.experimentId) ?? 0;
      if (t > prev) out.set(p.experimentId, t);
    }
    return out;
  }
}
