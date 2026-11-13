import { readyCore } from "@/lib/rust-core";
import {
  type Experiment,
  type IExperimentRepository,
  type ILibraryPinRepository,
  type IMilestoneRepository,
  type IPaperRepository,
  type IShareRepository,
  loadPinnedScreenData,
  type Milestone,
  type Paper,
} from "@weaveforge/core";

// --- load-plan-screen.use-case ---
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

// --- local-day ---
/** The local calendar day of `now` as `yyyy-mm-dd`, the form the plan timeline takes as "today". */
export function localIsoDay(now: Date = new Date()): string {
  return readyCore().isoDayFromParts(now.getFullYear(), now.getMonth() + 1, now.getDate());
}
