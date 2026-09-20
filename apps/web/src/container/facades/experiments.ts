import type { ManageExperimentUseCase } from "@weaveforge/core";
import { isStaleRunningExperiment, mapLimit, STALE_RUNNING_MS } from "@weaveforge/core";
import type { LoadExperimentsScreenUseCase, ExperimentsScreenData } from "@/features/experiments/application/load-experiments-screen.use-case";
import type { IMetricRepository, MetricPoint } from "@weaveforge/core";

/**
 * How many stale runs are asked to change status at once.
 *
 * Twelve abandoned runs used to mean twelve concurrent PATCHes. Three is enough
 * to keep the round trips overlapping without saturating a phone's radio, and
 * this is a maintenance path where latency does not matter.
 */
const STALE_STATUS_CONCURRENCY = 3;

/** How many artifact uploads may be in flight together. See `attachArtifacts`. */
const ARTIFACT_UPLOAD_CONCURRENCY = 3;

export class ExperimentsFacade {
  /** Non-null while a reconciliation is in flight, so callers can join it. */
  private reconciling: Promise<void> | null = null;

  constructor(
    private readonly deps: {
      load: LoadExperimentsScreenUseCase;
      experiments: import("@weaveforge/core").IExperimentRepository;
      papers: import("@weaveforge/core").IPaperRepository;
      metrics: IMetricRepository;
      manageExperiment: ManageExperimentUseCase;
      artifacts: import("@/features/experiments/infrastructure/experiment-artifact-store").ExperimentArtifactStore;
    },
  ) {}

  /**
   * Reading the screen. A read, with no writes hiding in it.
   *
   * This used to delegate to the reconciliation below, which writes. That made
   * opening a screen a mutation: every mount, project switch and poll issued
   * status updates, and React's development double-invoke issued them twice.
   * A read path is the cheapest place to hang maintenance and the worst one to
   * put it, because it runs more often than anything else.
   */
  loadScreenData(): Promise<ExperimentsScreenData> {
    return this.deps.load.execute();
  }

  /**
   * Mark runs that have gone quiet as abandoned. Maintenance, called from a
   * scheduler rather than from a load.
   *
   * Single-flight: two callers — a mount and a poll, or two tabs — join one
   * batch of writes instead of racing to issue the same updates. The failure of
   * an individual write is still swallowed, because a failed one is retried by
   * the next reconciliation; what must not happen is two concurrent ones.
   */
  reconcileStaleRuns(): Promise<void> {
    if (this.reconciling) return this.reconciling;
    this.reconciling = this.runReconciliation().finally(() => {
      this.reconciling = null;
    });
    return this.reconciling;
  }

  private async runReconciliation(): Promise<void> {
    const data = await this.deps.load.execute();
    // Only runs this project owns. The screen merges in other people's pinned
    // and shared experiments, so a filter on `status` alone would let opening
    // one's own screen rewrite a colleague's run status — the screen's own
    // read-only guard (`isReadOnlyExperiment`) is a UI affordance, not a rule
    // this path was applying.
    const stale = data.experiments.filter(
      (experiment) =>
        experiment.status === "running" && !data.pinnedSharedBy.has(experiment.id),
    );
    if (stale.length === 0) return;

    const lastMetric = await this.deps.metrics.latestActivityAt(stale.map((e) => e.id));
    const abandoned = stale.filter((experiment) =>
      isStaleRunningExperiment(experiment, Date.now(), STALE_RUNNING_MS, lastMetric.get(experiment.id)),
    );
    if (abandoned.length === 0) return;

    await mapLimit(abandoned, STALE_STATUS_CONCURRENCY, (experiment) =>
      this.deps.manageExperiment.setStatus(experiment.id, "abandoned").catch(() => null),
    );
  }

  /**
   * Turn stored artifact entries into URLs that can be rendered right now.
   *
   * Entries are a mix of storage paths and absolute links; only the paths need
   * signing, and the signature is good for an hour. Resolve at render time
   * rather than storing the result — that is the mistake this replaces.
   */
  artifactViewUrls(entries: readonly string[]): Promise<(string | null)[]> {
    return this.deps.artifacts.viewUrls(entries);
  }

  /**
   * Attach files a person picked, and hand back the experiment they belong to.
   *
   * Uploaded first and recorded second, so a failed upload leaves no entry
   * pointing at bytes that are not there. The row is written once for the whole
   * batch rather than once per file: three figures chosen together are one
   * change to the run, and three saves race each other. The uploads themselves
   * are bounded — a person may pick twenty figures, and twenty concurrent
   * uploads is a saturated connection for everything else on the page.
   */
  async attachArtifacts(experimentId: string, files: readonly File[]) {
    const entries = await mapLimit(files, ARTIFACT_UPLOAD_CONCURRENCY, (file) =>
      this.deps.artifacts.upload(experimentId, file),
    );
    return this.deps.manageExperiment.addArtifacts(experimentId, entries);
  }

  getExperiment(id: string) {
    return this.deps.experiments.getById(id);
  }

  loadExperiments() {
    return this.deps.experiments.list();
  }

  getPaper(id: string) {
    return this.deps.papers.getById(id);
  }

  metricHistory(experimentId: string): Promise<MetricPoint[]> {
    return this.deps.metrics.history(experimentId);
  }

  get manageExperiment() {
    return this.deps.manageExperiment;
  }
}
