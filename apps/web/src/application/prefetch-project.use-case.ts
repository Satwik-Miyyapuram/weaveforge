/**
 * Warm in-memory caches for the active project so first tab visits are instant.
 */
export class PrefetchProjectUseCase {
  private static lastRunAt = 0;

  constructor(
    private readonly loaders: {
      listPapers: () => Promise<unknown>;
      listLogEntries: () => Promise<unknown>;
      listReportSections: () => Promise<unknown>;
      listReadingLists: () => Promise<unknown>;
      getRelationGraph: () => Promise<unknown>;
      listExperiments: () => Promise<unknown>;
      listMilestones: () => Promise<unknown>;
      listVaultPages: () => Promise<unknown>;
      listTags: () => Promise<unknown>;
      listPins: () => Promise<unknown>;
    },
  ) {}

  async execute(): Promise<void> {
    const now = Date.now();
    if (now - PrefetchProjectUseCase.lastRunAt < 5000) return;
    PrefetchProjectUseCase.lastRunAt = now;

    const idle =
      typeof requestIdleCallback === "function"
        ? (fn: () => void) => requestIdleCallback(fn, { timeout: 3000 })
        : (fn: () => void) => setTimeout(fn, 250);

    // Warm the current route's likely data first; defer heavy lists.
    await Promise.allSettled([
      this.loaders.listPapers(),
      this.loaders.listVaultPages(),
      this.loaders.listPins(),
    ]);

    idle(() => {
      void Promise.allSettled([
        this.loaders.listLogEntries(),
        this.loaders.listReportSections(),
        this.loaders.listReadingLists(),
        this.loaders.getRelationGraph(),
        this.loaders.listExperiments(),
        this.loaders.listMilestones(),
        this.loaders.listTags(),
      ]);
    });
  }
}
