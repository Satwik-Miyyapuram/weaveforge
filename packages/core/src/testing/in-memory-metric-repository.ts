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

  async history(
    experimentId: string,
    metric?: string,
    options?: { maxPoints?: number },
  ): Promise<MetricPoint[]> {
    const ordered = this.points
      .filter((p) => p.experimentId === experimentId)
      .filter((p) => (metric ? p.metric === metric : true))
      .sort((a, b) => (a.metric === b.metric ? a.step - b.step : a.metric.localeCompare(b.metric)))
      .map((p) => ({ ...p }));
    return options?.maxPoints == null ? ordered : reduceToBudget(ordered, options.maxPoints);
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

/**
 * The same stride the SQL half applies, per series.
 *
 * Kept in step deliberately: the in-memory repository is what an offline build
 * runs against and what the contract suite checks, so a budget that reduced one
 * and not the other would be exactly the difference those tests exist to catch.
 * `points` is already ordered by metric then step, so a run of equal metric
 * names is one series.
 */
function reduceToBudget(points: MetricPoint[], maxPoints: number): MetricPoint[] {
  const budget = Math.max(2, maxPoints);
  const kept: MetricPoint[] = [];
  for (let start = 0; start < points.length; ) {
    let end = start;
    while (end < points.length && points[end]!.metric === points[start]!.metric) end += 1;
    const total = end - start;
    if (total <= budget) {
      kept.push(...points.slice(start, end));
    } else {
      const stride = Math.max(1, Math.ceil(total / budget));
      for (let index = start; index < end; index += 1) {
        const position = index - start + 1;
        // First, last, and every stride-th. The two endpoints are what a reader
        // takes for "when it started" and "where it ended up", so they survive
        // whatever the stride — the result may be a point or two over budget.
        if (position === 1 || position === total || (position - 1) % stride === 0) {
          kept.push(points[index]!);
        }
      }
    }
    start = end;
  }
  return kept;
}
