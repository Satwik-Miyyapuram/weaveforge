import {
  buildListTree,
  mergePinnedScreenData,
  type IPaperRepository,
  type IReadingListRepository,
  type IShareRepository,
  type IVaultPageRepository,
  type Paper,
  type ReadingList,
  type ReadingListTreeNode,
  type VaultPage,
} from "@thesis/core";

export interface ReadingListsScreenData {
  tree: ReadingListTreeNode[];
  lists: ReadingList[];
  papers: Paper[];
  notes: VaultPage[];
  pinnedSharedBy: Map<string, string>;
  listCanComment: Map<string, boolean>;
}

export class LoadReadingListsScreenUseCase {
  constructor(
    private readonly deps: {
      lists: IReadingListRepository;
      papers: IPaperRepository;
      notes: IVaultPageRepository;
      pins?: import("@thesis/core").ILibraryPinRepository;
      shares?: IShareRepository;
    },
  ) {}

  async execute(): Promise<ReadingListsScreenData> {
    const [owned, papers, notes, pins, shares] = await Promise.all([
      this.deps.lists.list(),
      this.deps.papers.list(),
      this.deps.notes.list(),
      this.deps.pins?.listForProject() ?? Promise.resolve([]),
      this.deps.shares?.listSharedWithMe("reading_list") ?? Promise.resolve([]),
    ]);

    const merged = await mergePinnedScreenData({
      resourceType: "reading_list",
      owned,
      pins,
      shares,
      loadById: (id) => this.deps.lists.getById(id),
    });

    return {
      tree: buildListTree(owned),
      lists: merged.items,
      papers,
      notes,
      pinnedSharedBy: merged.pinnedSharedBy,
      listCanComment: merged.canComment,
    };
  }
}
