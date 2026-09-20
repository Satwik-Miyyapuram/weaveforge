import type {
  ILibraryPinRepository,
  IPaperRepository,
  IReadingListItemRepository,
  IReadingListRepository,
  IShareRepository,
  PaperSummary,
  ReadingList,
} from "@weaveforge/core";
import { mergePinnedScreenData } from "@weaveforge/core";

export interface PapersScreenData {
  /**
   * **Summaries**, not full papers: the card grid paints a title, authors and
   * tags, and the summary projection carries nothing else. Typing these as
   * `Paper` claimed an `abstract`/`bibtex`/`metadata` every element does not
   * have, which is how a written-back card could drop them (review-2 F6).
   */
  papers: PaperSummary[];
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
      pins?: ILibraryPinRepository;
      shares?: IShareRepository;
    },
  ) {}

  async execute(): Promise<PapersScreenData> {
    const [papers, lists, pins, shares] = await Promise.all([
      // The card projection, required on the port. The `?? list()` fallback that
      // stood here is what pulled every abstract and metadata bag into a list
      // render, on the screens that paint neither.
      this.deps.papers.listSummaries(),
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
