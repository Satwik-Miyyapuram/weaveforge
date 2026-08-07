import type {
  IReadingListItemRepository,
  IReadingListRepository,
  IPaperRepository,
  IShareRepository,
  Paper,
  ReadingList,
} from "@weaveforge/core";
import { mergePinnedScreenData } from "@weaveforge/core";

export interface PapersScreenData {
  papers: Paper[];
  lists: ReadingList[];
  membership: Map<string, Set<string>>;
  /** paperId -> sharer user id (pinned shared papers). */
  pinnedSharedBy: Map<string, string>;
  /** paperId -> whether the active share grant allows commenting. */
  paperCanComment: Map<string, boolean>;
}

export class LoadPapersScreenUseCase {
  constructor(
    private readonly deps: {
      papers: IPaperRepository;
      lists: IReadingListRepository;
      listItems: IReadingListItemRepository;
      pins?: import("@weaveforge/core").ILibraryPinRepository;
      shares?: IShareRepository;
    },
  ) {}

  async execute(): Promise<PapersScreenData> {
    const [papers, lists, pins, shares] = await Promise.all([
      this.deps.papers.listSummaries?.() ?? this.deps.papers.list(),
      this.deps.lists.list(),
      this.deps.pins?.listForProject() ?? Promise.resolve([]),
      this.deps.shares?.listSharedWithMe("paper") ?? Promise.resolve([]),
    ]);
    const items = await this.deps.listItems.listItemsForLists(lists.map((l) => l.id));
    const membership = new Map<string, Set<string>>(lists.map((l) => [l.id, new Set<string>()]));
    for (const it of items) {
      if (it.paperId) membership.get(it.listId)?.add(it.paperId);
    }

    const merged = await mergePinnedScreenData({
      resourceType: "paper",
      owned: papers,
      pins,
      shares,
      loadById: (id) => this.deps.papers.getById(id),
    });

    return {
      papers: merged.items,
      lists,
      membership,
      pinnedSharedBy: merged.pinnedSharedBy,
      paperCanComment: merged.canComment,
    };
  }
}
