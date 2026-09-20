import type {
  Experiment,
  IExperimentRepository,
  ILibraryPinRepository,
  IShareRepository,
} from "@weaveforge/core";
import { loadPinnedScreenData } from "@weaveforge/core";

export interface ExperimentsScreenData {
  experiments: Experiment[];
  pinnedSharedBy: Map<string, string>;
  experimentCanComment: Map<string, boolean>;
}

export class LoadExperimentsScreenUseCase {
  constructor(
    private readonly deps: {
      experiments: IExperimentRepository;
      pins?: ILibraryPinRepository;
      shares?: IShareRepository;
    },
  ) {}

  async execute(): Promise<ExperimentsScreenData> {
    const owned = await this.deps.experiments.list();

    const merged = await loadPinnedScreenData(this.deps, {
      resourceType: "experiment",
      owned,
      loadById: (id) => this.deps.experiments.getById(id),
    });

    return {
      experiments: merged.items,
      pinnedSharedBy: merged.pinnedSharedBy,
      experimentCanComment: merged.canComment,
    };
  }
}
