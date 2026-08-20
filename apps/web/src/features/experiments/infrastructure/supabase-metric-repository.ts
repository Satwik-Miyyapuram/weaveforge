import type { SupabaseClient } from "@supabase/supabase-js";
import type { IMetricRepository, MetricPoint } from "@weaveforge/core";
import {
  type MetricRow,
  toDomain,
} from "./metric-rows";

const TABLE = "experiment_metrics";

/**
 * Supabase adapter for the `experiment_metrics` curve table (migration 0016).
 * The dashboard only reads (`history`); the Python SDK is the writer. `user_id`
 * is filled by the column default (`auth.uid()`), so it isn't sent here.
 */
export class SupabaseMetricRepository implements IMetricRepository {
  constructor(private readonly db: SupabaseClient) {}

  async append(points: MetricPoint[]): Promise<void> {
    if (points.length === 0) return;
    const rows = points.map((p) => ({
      experiment_id: p.experimentId,
      metric: p.metric,
      step: p.step,
      value: p.value,
      wall_time: p.wallTime ?? null,
    }));
    const { error } = await this.db.from(TABLE).insert(rows);
    if (error) throw error;
  }

  async history(experimentId: string, metric?: string): Promise<MetricPoint[]> {
    let q = this.db.from(TABLE).select("*").eq("experiment_id", experimentId);
    if (metric) q = q.eq("metric", metric);
    q = q.order("metric", { ascending: true }).order("step", { ascending: true });
    const { data, error } = await q;
    if (error) throw error;
    return (data as MetricRow[]).map(toDomain);
  }

  async latestActivityAt(experimentIds: readonly string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (experimentIds.length === 0) return out;
    const { data, error } = await this.db
      .from(TABLE)
      .select("experiment_id, wall_time")
      .in("experiment_id", [...experimentIds])
      .not("wall_time", "is", null)
      .order("wall_time", { ascending: false });
    if (error) throw error;
    for (const row of data ?? []) {
      const id = row.experiment_id as string;
      if (out.has(id)) continue;
      const t = Date.parse(String(row.wall_time));
      if (Number.isFinite(t)) out.set(id, t);
    }
    return out;
  }
}

