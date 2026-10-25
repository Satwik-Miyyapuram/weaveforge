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
import { fetchSuperviseeMilestonesAndLogs } from "@/features/dashboard/application/fetch-supervisee-data";

export class DashboardFacade {
  constructor(
    private readonly deps: {
      layout: IDashboardLayoutRepository;
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

  statsPorts() {
    const supervision = this.deps.supervision;
    return {
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
