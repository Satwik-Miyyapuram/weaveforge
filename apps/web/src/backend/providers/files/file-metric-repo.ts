/**
 * Experiment metrics as CSV chunks beside the experiment file (0.9.7 L3):
 * `<experiment file minus .md>/metrics/main/<batch>.csv`, the format of
 * `wf_core::metric_csv` (shared with the SDK and the upgrade export).
 *
 * Laws (proved in test/file-metric-repo.test.ts):
 * - Each `append` batch is one write-once chunk named by its content, so a
 *   retried batch writes nothing new.
 * - `history` merges every chunk (one point per run, step and metric) and
 *   thins each metric to about `maxPoints`, keeping the first and last point.
 * - A chunk that does not decode is skipped and reported, never fatal.
 */
import {
  NotFoundError,
  type Experiment,
  type IMetricRepository,
  type IWorkspaceFs,
  type MetricBudget,
  type MetricPoint,
} from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";
import { FileEntityStore, type ProjectRoot } from "./file-entity-store";

/** Points from the app go to one run, as the SDK's default. */
const RUN = "main";

interface Row {
  run: string;
  step: number;
  metric: string;
  value: number;
  time?: string;
}

async function batchId(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return `l${[...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export class FileMetricRepository implements IMetricRepository {
  private readonly experiments: FileEntityStore<Experiment>;

  constructor(
    private readonly fs: IWorkspaceFs,
    root: ProjectRoot,
  ) {
    this.experiments = new FileEntityStore<Experiment>(fs, root, "experiment");
  }

  async append(points: MetricPoint[]): Promise<void> {
    const byExperiment = new Map<string, MetricPoint[]>();
    for (const p of points) byExperiment.set(p.experimentId, [...(byExperiment.get(p.experimentId) ?? []), p]);
    for (const [id, batch] of byExperiment) {
      const dir = await this.metricsDir(id);
      if (!dir) throw new NotFoundError(`No experiment with id "${id}".`);
      const rows: Row[] = batch.map((p) => ({
        run: RUN,
        step: p.step,
        metric: p.metric,
        value: p.value,
        ...(p.wallTime ? { time: p.wallTime } : {}),
      }));
      const text = readyCore().metricCsvEncode(rows);
      const path = `${dir}/${RUN}/${await batchId(text)}.csv`;
      await this.fs.mkdirp(path.slice(0, path.lastIndexOf("/")));
      // Write-once: the same batch again finds its chunk already there.
      if (!this.fs.writeTextIf) throw new Error(`${path}: this workspace cannot write without overwriting.`);
      await this.fs.writeTextIf(path, text, null);
    }
  }

  async history(experimentId: string, metric: string | undefined, budget: MetricBudget): Promise<MetricPoint[]> {
    return (await this.rows(experimentId, metric, budget.maxPoints)).map((r) => ({
      experimentId,
      metric: r.metric,
      step: r.step,
      value: r.value,
      ...(r.time ? { wallTime: r.time } : {}),
    }));
  }

  async latestActivityAt(ids: readonly string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const id of ids) {
      let latest = Number.NaN;
      for (const r of await this.rows(id, undefined, 0)) {
        const t = r.time ? Date.parse(r.time) : Number.NaN;
        if (!Number.isNaN(t) && !(t <= latest)) latest = t;
      }
      if (!Number.isNaN(latest)) out.set(id, latest);
    }
    return out;
  }

  /** The experiment's `metrics` folder, or null when the experiment does not exist. */
  private async metricsDir(id: string): Promise<string | null> {
    const found = await this.experiments.find(id);
    return found ? `${found.path.replace(/\.md$/, "")}/metrics` : null;
  }

  private async rows(experimentId: string, metric: string | undefined, maxPoints: number): Promise<Row[]> {
    const dir = await this.metricsDir(experimentId);
    if (!dir || !(await this.fs.stat(dir))) return [];
    const paths: string[] = [];
    for await (const e of this.fs.walk(dir)) if (e.kind === "file" && e.path.endsWith(".csv")) paths.push(e.path);
    paths.sort();
    const texts = await Promise.all(paths.map((p) => this.fs.readText(p)));
    const { rows, bad } = readyCore().metricCsvHistory(texts, metric, maxPoints) as { rows: Row[]; bad: number[] };
    for (const i of bad) console.warn(`Skipped ${paths[i]}: not a metrics chunk.`);
    return rows;
  }
}
