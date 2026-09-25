import type { SupabaseClient } from "@supabase/supabase-js";
import type { IMetricRepository, MetricBudget, MetricPoint } from "@weaveforge/core";
import { run } from "@/backend/providers/supabase/row-access";
import {
  type MetricRow,
  toDomain,
} from "./metric-rows";

/**
 * The relation a write goes to: the **view**, not the row table.
 *
 * `experiment_metrics` has been a view since 0114/0115 — the row store is
 * `experiment_metric_points` and `experiment_metric_chunks` holds settled points
 * packed into arrays — and 0114:321 / 0115:136 install `INSTEAD OF INSERT`
 * triggers that route a write into the row table.
 *
 * The trigger is not incidental, it is the interface. A point arrives carrying the
 * metric's **name**; the row table stores `metric_id`, and the trigger does the
 * name lookup on the way in (`experiment_metric_name_id`). Writing to the table
 * directly therefore fails outright — `column "metric" of relation
 * "experiment_metric_points" does not exist` (42703) — which an integration test
 * in `backend/test/metric-activity.test.ts` now pins, because this was got wrong
 * once: a review read the view as a read-only relation and prescribed inserting
 * into the table, which would have broken the write.
 *
 * Reads go to the same view for the opposite reason: it is what unions the
 * expanded chunks in with the loose rows.
 */
const VIEW_METRICS = "experiment_metrics";

/**
 * Rows per insert.
 *
 * A single `insert` of a whole run's points is one request whose body grows
 * without bound — an array parameter or a request body built from an unbounded
 * list is the shape `check:hygiene` fails an API route for. Chunking turns one
 * catastrophic failure at some tens of thousands of rows into N bounded requests.
 */
const INSERT_CHUNK = 1000;

/**
 * Experiment ids per `latest_metric_activity` call.
 *
 * A Postgres array parameter is bound as one text literal, so its cost is
 * quadratic in its own length and it hits statement-size limits at a few tens of
 * thousands of elements. The list is tens of ids today, which is exactly the
 * kind of bound that is true until it is not.
 */
const IDS_PER_RPC = 500;

/**
 * Supabase adapter for the `experiment_metrics` curve data.
 *
 * The dashboard reads history through the `experiment_metrics` view and the
 * Python SDK is the writer, over the ingest API. `metric_history` does the
 * downsampling where the data lives; nothing here pages a whole series into the
 * browser.
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
    // Chunked, because one insert of a whole run is a request body that grows
    // without bound, and `check:hygiene` fails an API route for exactly that
    // shape. `user_id` is never sent: the trigger coalesces it to `auth.uid()`,
    // which is also what the row table's insert policy checks — so the caller's
    // identity, not the payload, decides who owns the row.
    for (let start = 0; start < payload.length; start += INSERT_CHUNK) {
      await run(this.db.from(VIEW_METRICS).insert(payload.slice(start, start + INSERT_CHUNK)));
    }
  }

  /**
   * Samples for one experiment, step-ordered.
   *
   * One bounded request to `metric_history`, which reduces the series where the
   * data lives — so what crosses the wire is already the size the chart needs,
   * and the response cannot be truncated by a server row cap because it never
   * approaches one.
   *
   * This used to fall back to a paging loop over the view whenever the budget was
   * omitted, materialising the entire run — 2 000 000 rows for a 400 000-step run
   * logging five metrics — as that many JS objects, on a tablet, for a chart a few
   * thousand pixels wide. The fallback is gone and the budget is required on the
   * port: an unbounded read is not a thing a cheap-looking call should be able to
   * do by forgetting an argument. The paging loop itself was correct (it advanced
   * by rows received, which is the right answer to a server row cap); it was
   * answering a question no chart has.
   */
  async history(
    experimentId: string,
    metric: string | undefined,
    budget: MetricBudget,
  ): Promise<MetricPoint[]> {
    const { data, error } = await this.db.rpc("metric_history", {
      p_experiment_id: experimentId,
      p_metric: metric ?? null,
      p_max_points: budget.maxPoints,
    });
    if (error) throw error;
    return ((data ?? []) as MetricRow[]).map(toDomain);
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
   *
   * The id list is chunked, and the chunks are merged by max per id so the
   * answer does not change when the chunk count does.
   */
  async latestActivityAt(experimentIds: readonly string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (experimentIds.length === 0) return out;

    for (let start = 0; start < experimentIds.length; start += IDS_PER_RPC) {
      const { data, error } = await this.db.rpc("latest_metric_activity", {
        p_experiment_ids: [...experimentIds.slice(start, start + IDS_PER_RPC)],
      });
      if (error) throw error;

      for (const row of (data ?? []) as {
        experiment_id: string;
        last_wall_time: string | null;
      }[]) {
        const t = Date.parse(String(row.last_wall_time));
        if (!Number.isFinite(t)) continue;
        const previous = out.get(row.experiment_id);
        if (previous === undefined || t > previous) out.set(row.experiment_id, t);
      }
    }
    return out;
  }
}
