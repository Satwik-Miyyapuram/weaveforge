/**
 * Repository contracts for reading lists.
 *
 * Two interfaces, segregated by responsibility (ISP): one for the list
 * hierarchy, one for membership (the paper<->list join). A read-only tree view
 * depends only on what it needs. Both are defined in the domain layer (DIP) and
 * each has its own shared contract suite.
 */

import type {
  IReadableRepository,
  IWritableRepository,
} from "../../../shared/repository.js";
import type {
  ReadingList,
  ReadingListFilter,
  ReadingListItem,
  ReadingListTreeNode,
} from "./reading-list.js";

export interface IReadingListRepository
  extends IReadableRepository<ReadingList, ReadingListFilter>,
    IWritableRepository<ReadingList> {
  /** All lists assembled into the nested tree. */
  getTree(): Promise<ReadingListTreeNode[]>;
}

export interface IReadingListItemRepository {
  /** Membership rows for a given list. */
  listItems(listId: string): Promise<ReadingListItem[]>;
  /**
   * Membership rows for many lists in one query (avoids an N+1 of `listItems`
   * when building a list→members map). Caller groups by `listId`.
   */
  listItemsForLists(listIds: readonly string[]): Promise<ReadingListItem[]>;
  /** All lists a given paper belongs to. */
  listsForPaper(paperId: string): Promise<ReadingListItem[]>;
  /** All lists a given note belongs to. */
  listsForNote(vaultPageId: string): Promise<ReadingListItem[]>;
  /** Look up a single paper membership by (list, paper). Null if absent. */
  find(listId: string, paperId: string): Promise<ReadingListItem | null>;
  /** Look up a single note membership by (list, note). Null if absent. */
  findNote(listId: string, vaultPageId: string): Promise<ReadingListItem | null>;
  add(item: ReadingListItem): Promise<void>;
  remove(id: string): Promise<void>;
}
