import type { Member } from "@weaveforge/core";
import { SHAREABLE_TYPES, shareAllowsComment } from "@weaveforge/core";
import type { ManageSharingUseCase } from "@weaveforge/core";
import type { IMemberRepository } from "@weaveforge/core";
import type { ISharedReader } from "@/features/sharing/domain/shared-reader";
import {
  loadSharedItemDetails,
  type SharedItemDetail,
} from "@/features/sharing/application/load-shared-details";
import type { IPaperRepository, IExperimentRepository, IVaultPageRepository, IReadingListRepository } from "@weaveforge/core";

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
      SHAREABLE_TYPES.map((type) => {
        const ids: string[] = [];
        const owners: string[] = [];
        for (const s of shares) {
          if (s.resourceType !== type) continue;
          if (s.resourceId) ids.push(s.resourceId);
          else owners.push(s.ownerId);
        }
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
        shareAllowsComment(s, item.kind, item.id, item.ownerId),
      ),
    }));

    return { items, members };
  }
}
