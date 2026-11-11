import type { IReadableRepository, IWritableRepository } from "../../../shared/parts.js";
import type {
  ReadingList,
  ReadingListFilter,
  ReadingListItem,
  ReadingListTreeNode,
} from "./reading-list.js";
import type { ScreeningDecision } from "./screening.js";

// --- reading-list-repository ---
/**
 * Repository contracts for reading lists.
 *
 * Two interfaces, segregated by responsibility (ISP): one for the list
 * hierarchy, one for membership (the paper<->list join). A read-only tree view
 * depends only on what it needs. Both are defined in the domain layer (DIP) and
 * each has its own shared contract suite.
 */
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

// --- screening-repository ---
/**
 * Where screening decisions are kept.
 *
 * Read by item rather than by list: the rows belong to membership, and a
 * repository that took a list id would have to know how membership is joined,
 * which is the list repository's business and not this one's.
 */
export interface IScreeningRepository {
  /** Every decision recorded against these items, by any reviewer, at any stage. */
  listForItems(itemIds: readonly string[]): Promise<ScreeningDecision[]>;
  /**
   * Record a decision, replacing this reviewer's own answer at this stage.
   *
   * An upsert rather than an insert because changing your mind is a normal part
   * of screening -- and because the alternative, a second row, would make
   * "what did they decide" a question with two answers.
   */
  record(decision: ScreeningDecision): Promise<void>;
  remove(id: string): Promise<void>;
}
