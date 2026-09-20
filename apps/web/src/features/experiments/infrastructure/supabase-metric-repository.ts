import type { SupabaseClient } from "@supabase/supabase-js";
import type { IMetricRepository, MetricPoint } from "@weaveforge/core";
import { rows, run } from "@/backend/providers/supabase/row-access";
import {
  type MetricRow,
  toDomain,
} from "./metric-rows";

const TABLE = "experiment_metrics";

/**
 * Columns `toDomain` reads. `experiment_metrics` is a view since 0114/0115 and
 * exposes exactly these plus `user_id`, so `select("*")` fetched a column nobody
 * maps — and, before 0114, three more.
 */
const METRIC_COLUMNS = "metric, step, value, wall_time";

/**
 * Rows per request in the paging loop below.
 *
 * Only a starting point: the loop advances by however many rows actually came
 * back, so a server row cap smaller than this costs extra round trips rather
 * than missing data.
 */
const PAGE = 1000;

/**
 * Supabase adapter for the `experiment_metrics` curve data.
 *
 * `experiment_metrics` is a **view** as of 0114/0115: the row store is
 * `experiment_metric_points`, and `experiment_metric_chunks` holds settled
 * points packed into arrays, with the view unioning the expanded chunks and the
 * loose rows. The dashboard reads history through it and the Python SDK is the
 * writer. `user_id` is filled by the column default (`auth.uid()`).
 */
export class SupabaseMetricRepository implements IMetricRepository {
  constructor(private readonly db: SupabaseClient) {}

  async append(points: MetricPoint[]): Promise<void> {
    if (points.length === 0) return;
    const payload = points.map((p) => ({
      experiment_id: p.experimentId,
      metric: p.metric,
      step: p.step,
      value: p.value,
      wall_time: p.wallTime ?? null,
    }));
    await run(this.db.from(TABLE).insert(payload));
  }

  /**
   * Samples for one experiment, step-ordered.
   *
   * With a `maxPoints` budget this is one bounded request to `metric_history`,
   * which reduces the series where the data lives — so what crosses the wire is
   * already the size the chart needs, and the response cannot be truncated by a
   * server row cap because it never approaches one.
   *
   * Without a budget it pages by **rows received**, not by page size. The
   * obvious loop — advance a fixed page and stop when a short page arrives —
   * stops after the first page on any deployment whose `db-max-rows` is below
   * that page size, because a capped response *is* a short page; the curve then
   * ends early, which a researcher reads as "training stopped here". Advancing
   * by what came back cannot skip rows and cannot stop early, whatever the cap
   * is; the price of a small cap is more requests.
   *
   * `(metric, step)` is a total order here — the store's primary key is
   * `(experiment_id, metric_id, step)` — which is what makes paging safe from
   * duplicates and gaps.
   */
  async history(
    experimentId: string,
    metric?: string,
    options?: { maxPoints?: number },
  ): Promise<MetricPoint[]> {
    if (options?.maxPoints != null) {
      const { data, error } = await this.db.rpc("metric_history", {
        p_experiment_id: experimentId,
        p_metric: metric ?? null,
        p_max_points: options.maxPoints,
      });
      if (error) throw error;
      return ((data ?? []) as MetricRow[]).map(toDomain);
    }

    const all: MetricRow[] = [];
    for (let from = 0; ; ) {
      let q = this.db
        .from(TABLE)
        .select(METRIC_COLUMNS)
        .eq("experiment_id", experimentId)
        .order("metric", { ascending: true })
        .order("step", { ascending: true })
        .range(from, from + PAGE - 1);
      if (metric) q = q.eq("metric", metric);
      const page = await rows<MetricRow>(q);
      if (page.length === 0) break;
      all.push(...page);
      from += page.length;
    }
    return all.map(toDomain);
  }

  /**
   * The newest sample wall-clock per experiment, for stale-run detection.
   *
   * One round trip and one row per experiment, computed where the data lives.
   * It used to select every `(experiment_id, wall_time)` row and take the first
   * per experiment in the browser, which needed the whole group to be present —
   * and the server's row cap makes that untrue without saying so. The caller
   * reads a missing entry as "nothing logged recently" and marks the run
   * abandoned, so the failure was a write, not a stale label.
   */
  async latestActivityAt(experimentIds: readonly string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (experimentIds.length === 0) return out;

    const { data, error } = await this.db.rpc("latest_metric_activity", {
      p_experiment_ids: [...experimentIds],
    });
    if (error) throw error;

    for (const row of (data ?? []) as { experiment_id: string; last_wall_time: string | null }[]) {
      const t = Date.parse(String(row.last_wall_time));
      if (Number.isFinite(t)) out.set(row.experiment_id, t);
    }
    return out;
  }
}
