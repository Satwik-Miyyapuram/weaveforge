import { ProjectRepository } from "@/backend/providers/postgrest/project-scoped-repository";
import {
  deleteRowById,
  inChunks,
  rowById,
  rows,
  run,
} from "@/backend/providers/postgrest/row-access";
import { readyCore, typedCore } from "@/lib/rust-core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Experiment,
  ExperimentFilter,
  ExperimentPatch,
  ExperimentStatus,
  IBlobStore,
  ICurrentUserProvider,
  IExperimentRepository,
  IMetricRepository,
  MetricBudget,
  MetricPoint,
} from "@weaveforge/core";

// --- experiment-artifact-store ---
const BUCKET = "experiment-artifacts";
const SIGNED_TTL_S = 3600;

/**
 * Signs experiment artifacts for viewing.
 *
 * `experiments.artifacts` holds two kinds of entry, and they have to keep
 * working side by side:
 *
 *   - a **storage path** (`{userId}/{experimentId}/{name}`) written by
 *     `log_bytes` through `/api/sdk/artifacts`
 *   - an **absolute URL** written by `log_artifact(url)`, which exists so a run
 *     can point at something already hosted elsewhere — a wandb run, an S3
 *     object
 *
 * Only the first kind is ours to sign. Telling them apart by "does this parse
 * as an absolute URL" is the whole rule.
 *
 * Paths are stored rather than signed URLs because a presigned URL is a
 * credential with an expiry, and SigV4 caps that at seven days no matter what
 * you ask for. Storing one as though it were an address gives you a link that
 * works all week and then serves an XML error forever.
 */
export class ExperimentArtifactStore {
  constructor(
    private readonly blobs: IBlobStore,
    private readonly session: ICurrentUserProvider,
  ) {}

  /**
   * Store one file a person attached, and return the entry to record.
   *
   * The key is `{userId}/{experimentId}/{uuid}/{name}`: the user id first
   * because that is what RLS reads, and a uuid directory rather than a uuid
   * filename so two figures called `loss.png` can both exist while the name
   * shown under each stays the one their author gave it.
   */
  async upload(experimentId: string, file: File): Promise<string> {
    const userId = await this.session.requireUserId();
    const path = `${userId}/${experimentId}/${crypto.randomUUID()}/${readyCore().safeName(file.name)}`;
    await this.blobs.upload(BUCKET, path, file, file.type || "application/octet-stream");
    return path;
  }

  /**
   * Resolve entries to viewable URLs, in the order given.
   *
   * Absolute URLs pass through untouched; storage paths are signed for an hour.
   * A path that cannot be signed comes back `null` so the caller can leave a
   * gap rather than render a broken image.
   */
  async viewUrls(entries: readonly string[]): Promise<(string | null)[]> {
    const paths = entries.filter((entry) => !readyCore().isAbsoluteUrl(entry));
    const signed = paths.length ? await this.blobs.signedUrls(BUCKET, paths, SIGNED_TTL_S) : [];

    const byPath = new Map(paths.map((path, index) => [path, signed[index] ?? null]));
    return entries.map((entry) =>
      readyCore().isAbsoluteUrl(entry) ? readyCore().viewableArtifactUrl(entry, isTauriShell()) : (byPath.get(entry) ?? null),
    );
  }
}

/** True inside the Tauri shell, which defines `__TAURI_INTERNALS__` on the page. */
export function isTauriShell(scope: object = globalThis): boolean {
  return "__TAURI_INTERNALS__" in scope;
}

// --- postgrest-experiment-repository ---
// --- experiment-rows ---
/**
 * How experiment rows are stored. The mapping to the domain type is in Rust (wf-core).
 *
 * Shared by both backend providers, which talk to the same table through
 * different clients.
 */

export interface ExperimentRow {
  id: string;
  name: string;
  hypothesis: string | null;
  status: ExperimentStatus;
  repo_url: string | null;
  commit_sha: string | null;
  branch: string | null;
  run_command: string | null;
  config: Record<string, unknown> | null;
  metrics: Record<string, unknown> | null;
  artifacts: string[] | null;
  result_note: string | null;
  started_at: string | null;
  finished_at: string | null;
  related_paper: string | null;
  created_at: string;
}

// --- postgrest-experiment-repository ---
/**
 * The columns a ExperimentRow is read as, named rather than starred.
 *
 * Derived from the row type: exactly the fields the mapper reads, where a star
 * would mean "whatever the table grows next".
 */
const EXPERIMENT_COLUMNS = "id,name,hypothesis,status,repo_url,commit_sha,branch,run_command,config,metrics,artifacts,result_note,started_at,finished_at,related_paper,created_at";

const TABLE = "experiments";

// The wasm mapper returns the Rust `Experiment` (domain fields); its generated binding type is a status subset, hence the cast.
const experimentToDomain = (r: ExperimentRow): Experiment => typedCore().experimentRowToDomain(r) as unknown as Experiment;
const experimentToRow = (e: Experiment) => typedCore().experimentToRow(e);
/** Required fields of a whole experiment, for a patch to be mapped through the row mapper. */
const PATCH_FILLER = { id: "", name: "", status: "planned", config: {}, metrics: {}, artifacts: [], createdAt: "" };

export class PostgrestExperimentRepository extends ProjectRepository implements IExperimentRepository {

  async getById(id: string): Promise<Experiment | null> {
    const row = await rowById<ExperimentRow>(this.db, TABLE, id);
    return row ? experimentToDomain(row) : null;
  }

  /** Runs by id, filtered as `getById` is (not by project), in chunks. */
  async listByIds(ids: readonly string[]): Promise<Experiment[]> {
    const found = await inChunks(ids, (chunk) =>
      rows<ExperimentRow>(this.db.from(TABLE).select(EXPERIMENT_COLUMNS).in("id", chunk).order("id", { ascending: true })),
    );
    return found.map(experimentToDomain);
  }
  async list(filter?: ExperimentFilter): Promise<Experiment[]> {
    let q = this.db.from(TABLE).select(EXPERIMENT_COLUMNS);
    if (this.pid) q = q.or(`project_id.eq.${this.pid},project_id.is.null`);
    if (filter?.status) q = q.eq("status", filter.status);
    if (filter?.relatedPaper) q = q.eq("related_paper", filter.relatedPaper);
    q = q.order("created_at", { ascending: false });
    const all = (await rows<ExperimentRow>(q)).map(experimentToDomain);
    // Names are encrypted at rest, so the server cannot match them: filter here.
    const needle = filter?.nameContains?.toLowerCase();
    return needle ? all.filter((e) => e.name.toLowerCase().includes(needle)) : all;
  }
  async save(entity: Experiment): Promise<void> {
    const row = { ...experimentToRow(entity), ...(this.pid ? { project_id: this.pid } : {}) };
    await run(this.db.from(TABLE).upsert(row));
  }
  /**
   * Update only the named columns. The row mapper builds them, so the
   * camel-to-column mapping and the undefined-to-null rule stay in one place.
   */
  async patch(id: string, fields: ExperimentPatch): Promise<void> {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    // The row mapper takes a whole experiment; the filler supplies the fields a
    // patch leaves out. Only the patch's own keys are copied below, so it never
    // reaches the row.
    const full: Record<string, unknown> = { ...experimentToRow({ ...PATCH_FILLER, ...fields } as Experiment) };
    const row: Record<string, unknown> = {};
    for (const key of keys) {
      const column = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      if (column in full) row[column] = full[column];
    }
    await run(this.db.from(TABLE).update(row).eq("id", id));
  }
  async delete(id: string): Promise<void> {
    await deleteRowById(this.db, TABLE, id);
  }
}

// --- postgrest-metric-repository ---
// --- metric-rows ---
/**
 * How metric rows are stored. The mapping to the domain type is in Rust (wf-core).
 *
 * Shared by both backend providers. They talk to the *same* table — one through
 * supabase-js, the other through `pg` — so the column shape and the mapping are
 * not per-provider facts, and holding two copies of them is how they drift.
 */
export interface MetricRow {
  experiment_id: string;
  metric: string;
  step: number;
  value: number;
  /**
   * `timestamptz` as PostgREST returns it — **not** always a string.
   *
   * `supabase-js` hands back an ISO string, and the local PostgREST-shaped client
   * hands back a `Date`, because that is what the driver produced. Typing this
   * `string | null` made the difference invisible: the field is declared
   * `wallTime?: string` on `MetricPoint`, nothing narrowed it, and a `Date`
   * therefore travelled out of the adapter as a `Date` — through a type that
   * promises a string. the wasm wrapper normalises it, which is why this is
   * `string | Date | null` rather than the lie the previous type told.
   */
  wall_time: string | Date | null;
}

// --- postgrest-metric-repository ---
/** Bindings type f64 as number | null (NaN/Infinity serialise as null); values are always finite. */
const toFinite = (n: number | null): number => n as number;

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
 * PostgREST adapter for the `experiment_metrics` curve data.
 *
 * The dashboard reads history through the `experiment_metrics` view and the
 * Python SDK is the writer, over the ingest API. `metric_history` does the
 * downsampling where the data lives; nothing here pages a whole series into the
 * browser.
 */
export class PostgrestMetricRepository implements IMetricRepository {
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
    // `metric_history` returns no `experiment_id` column; the Rust mapper requires
    // one, so the requested id is supplied (the domain type always carries it).
    return ((data ?? []) as Omit<MetricRow, "experiment_id">[]).map((row) => {
      const p = typedCore().metricRowToDomain({ ...row, experiment_id: experimentId } as MetricRow);
      return {
        experimentId: p.experimentId,
        metric: p.metric,
        step: toFinite(p.step),
        value: toFinite(p.value),
        wallTime: p.wallTime ?? undefined,
      };
    });
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
