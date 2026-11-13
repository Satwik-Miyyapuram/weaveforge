import {
  type Experiment,
  type IExperimentRepository,
  type ILibraryPinRepository,
  type IShareRepository,
  loadPinnedScreenData,
} from "@weaveforge/core";

// --- load-experiments-screen.use-case ---
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

// --- remove-experiment ---
/**
 * Deletes an experiment, then the files it saved on this computer (desktop app only). The
 * experiment is gone either way, so a failed clean-up does not fail the delete.
 */
export async function removeExperiment(
  id: string,
  remove: (id: string) => Promise<void>,
  deleteLocalFiles?: (id: string) => Promise<void>,
): Promise<void> {
  await remove(id);
  await deleteLocalFiles?.(id).catch(() => undefined);
}
