import type {
  IReadingListItemRepository,
  IReadingListRepository,
  IShareRepository,
  IVaultPageRepository,
  ReadingList,
  VaultPage,
  VaultPageTreeNode,
} from "@thesis/core";
import { buildPageTree, mergePinnedScreenData } from "@thesis/core";

export interface VaultScreenData {
  tree: VaultPageTreeNode[];
  flat: VaultPage[];
  lists: ReadingList[];
  /** listId -> note ids in that list */
  membership: Map<string, Set<string>>;
  pinnedSharedBy: Map<string, string>;
  vaultCanComment: Map<string, boolean>;
  vaultCanEdit: Map<string, boolean>;
}

export class LoadVaultScreenUseCase {
  constructor(
    private readonly deps: {
      pages: IVaultPageRepository;
      lists: IReadingListRepository;
      listItems: IReadingListItemRepository;
      pins?: import("@thesis/core").ILibraryPinRepository;
      shares?: IShareRepository;
    },
  ) {}

  async execute(): Promise<VaultScreenData> {
    const [owned, lists, pins, shares] = await Promise.all([
      this.deps.pages.listSummaries?.() ?? this.deps.pages.list(),
      this.deps.lists.list(),
      this.deps.pins?.listForProject() ?? Promise.resolve([]),
      this.deps.shares?.listSharedWithMe("vault_page") ?? Promise.resolve([]),
    ]);
    const items = await this.deps.listItems.listItemsForLists(lists.map((l) => l.id));
    const membership = new Map<string, Set<string>>(lists.map((l) => [l.id, new Set<string>()]));
    for (const it of items) {
      if (it.vaultPageId) membership.get(it.listId)?.add(it.vaultPageId);
    }

    const merged = await mergePinnedScreenData({
      resourceType: "vault_page",
      owned,
      pins,
      shares,
      loadById: (id) => this.deps.pages.getById(id),
    });

    return {
      tree: buildPageTree(owned),
      flat: merged.items,
      lists,
      membership,
      pinnedSharedBy: merged.pinnedSharedBy,
      vaultCanComment: merged.canComment,
      vaultCanEdit: merged.canEdit,
    };
  }
}
