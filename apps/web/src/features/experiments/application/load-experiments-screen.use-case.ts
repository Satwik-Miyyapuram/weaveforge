import type { Experiment, IExperimentRepository, IShareRepository } from "@thesis/core";
import { mergePinnedScreenData } from "@thesis/core";

export interface ExperimentsScreenData {
  experiments: Experiment[];
  pinnedSharedBy: Map<string, string>;
  experimentCanComment: Map<string, boolean>;
}

export class LoadExperimentsScreenUseCase {
  constructor(
    private readonly deps: {
      experiments: IExperimentRepository;
      pins?: import("@thesis/core").ILibraryPinRepository;
      shares?: IShareRepository;
    },
  ) {}

  async execute(): Promise<ExperimentsScreenData> {
    const [owned, pins, shares] = await Promise.all([
      this.deps.experiments.list(),
      this.deps.pins?.listForProject() ?? Promise.resolve([]),
      this.deps.shares?.listSharedWithMe("experiment") ?? Promise.resolve([]),
    ]);

    const merged = await mergePinnedScreenData({
      resourceType: "experiment",
      owned,
      pins,
      shares,
      loadById: (id) => this.deps.experiments.getById(id),
    });

    return {
      experiments: merged.items,
      pinnedSharedBy: merged.pinnedSharedBy,
      experimentCanComment: merged.canComment,
    };
  }
}
