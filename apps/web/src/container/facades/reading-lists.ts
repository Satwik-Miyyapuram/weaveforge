import type { ManageReadingListUseCase, ReadingListItem } from "@weaveforge/core";
import type { LoadReadingListsScreenUseCase, ReadingListsScreenData } from "@/features/reading-lists/application/load-reading-lists-screen.use-case";

export class ReadingListsFacade {
  constructor(
    private readonly deps: {
      load: LoadReadingListsScreenUseCase;
      lists: import("@weaveforge/core").IReadingListRepository;
      listItems: import("@weaveforge/core").IReadingListItemRepository;
      manageReadingList: ManageReadingListUseCase;
    },
  ) {}

  loadScreenData(): Promise<ReadingListsScreenData> {
    return this.deps.load.execute();
  }

  getList(id: string) {
    return this.deps.lists.getById(id);
  }

  /**
   * Items in one list — coalesced with every other list asking in the same tick.
   *
   * The lists screen renders a node per list and each node loads its own items,
   * so a workspace with seven lists made seven round trips to paint one screen.
   * The repository already has a batched read; this collects the ids the render
   * pass asks for and issues exactly one.
   */
  listItems(listId: string): Promise<ReadingListItem[]> {
    this.pendingItemIds.add(listId);
    this.itemBatch ??= Promise.resolve().then(() => {
      const ids = [...this.pendingItemIds];
      this.pendingItemIds.clear();
      this.itemBatch = null;
      return this.deps.listItems.listItemsForLists(ids);
    });
    return this.itemBatch.then((rows) => rows.filter((row) => row.listId === listId));
  }

  private readonly pendingItemIds = new Set<string>();
  private itemBatch: Promise<ReadingListItem[]> | null = null;

  listItemsForLists(listIds: readonly string[]) {
    return this.deps.listItems.listItemsForLists(listIds);
  }

  get manageReadingList() {
    return this.deps.manageReadingList;
  }
}

export type { ReadingListsScreenData };
