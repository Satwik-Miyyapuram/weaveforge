import type {
  IExperimentRepository,
  ILogEntryRepository,
  IMilestoneRepository,
  IPaperRelationRepository,
  IPaperRepository,
  IReadingListRepository,
  IReportSectionRepository,
  ITagRepository,
  Member,
} from "@weaveforge/core";
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
      papers: IPaperRepository;
      sections: IReportSectionRepository;
      milestones: IMilestoneRepository;
      experiments: IExperimentRepository;
      logEntries: ILogEntryRepository;
      relations: IPaperRelationRepository;
      lists: IReadingListRepository;
      tags: ITagRepository;
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
