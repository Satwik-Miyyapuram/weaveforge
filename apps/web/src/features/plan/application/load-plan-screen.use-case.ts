import type {
  Experiment,
  IMilestoneRepository,
  IPaperRepository,
  IExperimentRepository,
  IShareRepository,
  Milestone,
  Paper,
} from "@thesis/core";
import { mergePinnedScreenData } from "@thesis/core";

export interface PlanScreenData {
  milestones: Milestone[];
  papers: Paper[];
  experiments: Experiment[];
  pinnedSharedBy: Map<string, string>;
  milestoneCanComment: Map<string, boolean>;
}

export class LoadPlanScreenUseCase {
  constructor(
    private readonly deps: {
      milestones: IMilestoneRepository;
      papers: IPaperRepository;
      experiments: IExperimentRepository;
      pins?: import("@thesis/core").ILibraryPinRepository;
      shares?: IShareRepository;
    },
  ) {}

  async execute(): Promise<PlanScreenData> {
    const [owned, papers, experiments, pins, shares] = await Promise.all([
      this.deps.milestones.list(),
      this.deps.papers.list(),
      this.deps.experiments.list(),
      this.deps.pins?.listForProject() ?? Promise.resolve([]),
      this.deps.shares?.listSharedWithMe("milestone") ?? Promise.resolve([]),
    ]);

    const merged = await mergePinnedScreenData({
      resourceType: "milestone",
      owned,
      pins,
      shares,
      loadById: (id) => this.deps.milestones.getById(id),
    });

    return {
      milestones: merged.items,
      papers,
      experiments,
      pinnedSharedBy: merged.pinnedSharedBy,
      milestoneCanComment: merged.canComment,
    };
  }
}
