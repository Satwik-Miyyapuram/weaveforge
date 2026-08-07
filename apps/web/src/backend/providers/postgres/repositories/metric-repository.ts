import type { IMetricRepository, MetricPoint } from "@weaveforge/core";
import type { PgRunner } from "../pg-runner";

interface MetricRow {
  experiment_id: string;
  metric: string;
  step: number;
  value: number;
  wall_time: string | null;
}

export class PostgresMetricRepository implements IMetricRepository {
  constructor(private readonly pg: PgRunner) {}

  async append(points: MetricPoint[]): Promise<void> {
    if (points.length === 0) return;
    const values: unknown[] = [];
    const tuples: string[] = [];
    let i = 1;
    for (const p of points) {
      tuples.push(`($${i}, $${i + 1}, $${i + 2}, $${i + 3}, $${i + 4})`);
      values.push(p.experimentId, p.metric, p.step, p.value, p.wallTime ?? null);
      i += 5;
    }
    await this.pg.exec(
      `insert into experiment_metrics (experiment_id, metric, step, value, wall_time)
       values ${tuples.join(", ")}`,
      values,
    );
  }

  async history(experimentId: string, metric?: string): Promise<MetricPoint[]> {
    const clauses = ["experiment_id = $1"];
    const params: unknown[] = [experimentId];
    if (metric) {
      params.push(metric);
      clauses.push(`metric = $${params.length}`);
    }
    const rows = await this.pg.query<MetricRow>(
      `select * from experiment_metrics where ${clauses.join(" and ")}
       order by metric asc, step asc`,
      params,
    );
    return rows.map(toDomain);
  }

  async latestActivityAt(experimentIds: readonly string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (experimentIds.length === 0) return out;
    const rows = await this.pg.query<{ experiment_id: string; last_at: string }>(
      `select experiment_id, max(wall_time) as last_at
       from experiment_metrics
       where experiment_id = any($1::uuid[]) and wall_time is not null
       group by experiment_id`,
      [experimentIds],
    );
    for (const row of rows) {
      const t = Date.parse(row.last_at);
      if (Number.isFinite(t)) out.set(row.experiment_id, t);
    }
    return out;
  }
}

function toDomain(r: MetricRow): MetricPoint {
  return {
    experimentId: r.experiment_id,
    metric: r.metric,
    step: r.step,
    value: r.value,
    wallTime: r.wall_time ?? undefined,
  };
}
