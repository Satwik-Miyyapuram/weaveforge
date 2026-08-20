import type { ManageExperimentUseCase } from "@weaveforge/core";
import { isStaleRunningExperiment, STALE_RUNNING_MS } from "@weaveforge/core";
import type { LoadExperimentsScreenUseCase, ExperimentsScreenData } from "@/features/experiments/application/load-experiments-screen.use-case";
import type { IMetricRepository, MetricPoint } from "@weaveforge/core";

export class ExperimentsFacade {
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

  loadScreenData(): Promise<ExperimentsScreenData> {
    return this.reconcileAndLoad();
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

  private async reconcileAndLoad(): Promise<ExperimentsScreenData> {
    const data = await this.deps.load.execute();
    const running = data.experiments.filter((e) => e.status === "running");
    const lastMetric = running.length
      ? await this.deps.metrics.latestActivityAt(running.map((e) => e.id))
      : new Map<string, number>();
    const stale = running.filter((e) =>
      isStaleRunningExperiment(e, Date.now(), STALE_RUNNING_MS, lastMetric.get(e.id)),
    );
    if (stale.length === 0) return data;

    const updated = await Promise.all(
      stale.map((e) =>
        this.deps.manageExperiment.setStatus(e.id, "abandoned").catch(() => null),
      ),
    );
    const byId = new Map(
      updated.filter((e): e is NonNullable<typeof e> => e != null).map((e) => [e.id, e]),
    );
    return {
      ...data,
      experiments: data.experiments.map((e) => byId.get(e.id) ?? e),
    };
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
