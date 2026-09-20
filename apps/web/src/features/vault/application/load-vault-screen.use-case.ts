import type {
  ILibraryPinRepository,
  IReadingListItemRepository,
  IReadingListRepository,
  IShareRepository,
  IVaultPageRepository,
  ReadingList,
  VaultPageSummary,
} from "@weaveforge/core";
import { mergePinnedScreenData } from "@weaveforge/core";

export interface VaultScreenData {
  /**
   * The flat list holds **summaries**.
   *
   * The screen paints titles and body previews; the full body arrives from
   * `getById` when a page is opened. These used to be typed as `VaultPage`,
   * which claimed a body every element does not have — and a card edit written
   * back through that type persisted `body: ""` over a real note (review-2 F6).
   */
  flat: VaultPageSummary[];
  /**
   * Which of `flat` this project owns, as opposed to pinned/shared into it.
   *
   * The screen used to derive this by walking a `tree` field that nothing
   * rendered — the tree existed only to answer "is this row mine?". That made
   * the tree load-bearing in a way nothing said, and it meant a shared note
   * could be added to the tree without being recognised as unowned (or, if the
   * tree were rebuilt from the merged list, recognised as owned and so dropped
   * from both sections). An explicit set says what it means.
   */
  ownedIds: Set<string>;
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
      pins?: ILibraryPinRepository;
      shares?: IShareRepository;
    },
  ) {}

  async execute(): Promise<VaultScreenData> {
    const [owned, lists, pins, shares] = await Promise.all([
      // Required on the port; see `IPaperRepository.listSummaries` for why the
      // call-site fallback is gone. `ownedIds` below is derived from this, so a
      // wider read would not have changed the answer — only the payload.
      this.deps.pages.listSummaries(),
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
      flat: merged.items,
      // From `owned`, not from the merged list: a pinned note is in `flat` and
      // is not ours, and conflating the two is what made a shared note either
      // disappear from the screen or read as owned.
      ownedIds: new Set(owned.map((page) => page.id)),
      lists,
      membership,
      pinnedSharedBy: merged.pinnedSharedBy,
      vaultCanComment: merged.canComment,
      vaultCanEdit: merged.canEdit,
    };
  }
}
