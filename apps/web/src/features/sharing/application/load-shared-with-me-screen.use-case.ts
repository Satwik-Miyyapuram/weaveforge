import type {
  IExperimentRepository,
  IMemberRepository,
  IPaperRepository,
  IReadingListRepository,
  IVaultPageRepository,
  ManageSharingUseCase,
  Member,
} from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";
import type { ISharedReader } from "@/features/sharing/domain/shared-reader";
import {
  loadSharedItemDetails,
  type SharedItemDetail,
} from "@/features/sharing/application/load-shared-details";

export interface LoadSharedWithMeScreenData {
  items: SharedItemDetail[];
  members: Member[];
}

export class LoadSharedWithMeScreenUseCase {
  constructor(
    private readonly deps: {
      sharing: ManageSharingUseCase;
      sharedReader: ISharedReader;
      members: IMemberRepository;
      papers: IPaperRepository;
      experiments: IExperimentRepository;
      vaultPages: IVaultPageRepository;
      readingLists: IReadingListRepository;
    },
  ) {}

  async execute(): Promise<LoadSharedWithMeScreenData> {
    const [shares, members] = await Promise.all([
      this.deps.sharing.listSharedWithMe(),
      this.deps.members.listDirectory(),
    ]);

    const groups = await Promise.all(
      readyCore().shareableTypes().map((type) => {
        const { ids, owners } = readyCore().shareTargets(shares, type);
        return this.deps.sharedReader.read(type, ids, owners);
      }),
    );
    const enriched = await loadSharedItemDetails(groups.flat(), {
      papers: this.deps.papers,
      experiments: this.deps.experiments,
      vaultPages: this.deps.vaultPages,
      readingLists: this.deps.readingLists,
    });
    const items = enriched.map((item) => ({
      ...item,
      canComment: shares.some((s) =>
        readyCore().shareAllowsComment(s, item.kind, item.id, item.ownerId),
      ),
    }));

    return { items, members };
  }
}
