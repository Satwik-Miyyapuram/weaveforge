import type { ILogEntryRepository, Member } from "@weaveforge/core";
import type { IDashboardLayoutRepository, DashboardLayout } from "@weaveforge/core";
import type { ISupervisionRepository } from "@weaveforge/core";
import type { PrefetchProjectUseCase } from "@/application/prefetch-project.use-case";
import { fetchSuperviseeMilestonesAndLogs } from "@/features/dashboard/application/fetch-supervisee-data";

export class DashboardFacade {
  constructor(
    private readonly deps: {
      layout: IDashboardLayoutRepository;
      prefetch: PrefetchProjectUseCase;
      projectId: () => string | null;
      papers: import("@weaveforge/core").IPaperRepository;
      sections: import("@weaveforge/core").IReportSectionRepository;
      milestones: import("@weaveforge/core").IMilestoneRepository;
      experiments: import("@weaveforge/core").IExperimentRepository;
      logEntries: ILogEntryRepository;
      relations: import("@weaveforge/core").IPaperRelationRepository;
      lists: import("@weaveforge/core").IReadingListRepository;
      tags: import("@weaveforge/core").ITagRepository;
      supervision: ISupervisionRepository;
    },
  ) {}

  getLayout(projectId: string) {
    return this.deps.layout.get(projectId);
  }

  saveLayout(projectId: string, layout: DashboardLayout) {
    return this.deps.layout.save(projectId, layout);
  }

  prefetch() {
    return this.deps.prefetch.execute();
  }

  statsPorts() {
    const supervision = this.deps.supervision;
    return {
      prefetch: () => this.deps.prefetch.execute(),
      listPapers: () => this.deps.papers.list(),
      listSections: () => this.deps.sections.list(),
      listMilestones: () =>
        this.deps.projectId() ? this.deps.milestones.list() : Promise.resolve([]),
      listExperiments: () => this.deps.experiments.list(),
      listLogEntries: () => this.deps.logEntries.list(),
      listRelations: () => this.deps.relations.getGraph(),
      getReadingListTree: () => this.deps.lists.getTree(),
      listTags: () => this.deps.tags.listWithCounts(),
      fetchSuperviseeData: (supervisees: readonly Member[]) =>
        fetchSuperviseeMilestonesAndLogs(supervision, supervisees),
    };
  }
}
