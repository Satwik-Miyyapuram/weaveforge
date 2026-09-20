import type {
  Experiment,
  IExperimentRepository,
  ILibraryPinRepository,
  IMilestoneRepository,
  IPaperRepository,
  IShareRepository,
  Milestone,
  Paper,
} from "@weaveforge/core";
import { loadPinnedScreenData } from "@weaveforge/core";

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
      pins?: ILibraryPinRepository;
      shares?: IShareRepository;
    },
  ) {}

  async execute(): Promise<PlanScreenData> {
    const [owned, papers, experiments] = await Promise.all([
      this.deps.milestones.list(),
      this.deps.papers.list(),
      this.deps.experiments.list(),
    ]);

    const merged = await loadPinnedScreenData(this.deps, {
      resourceType: "milestone",
      owned,
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
