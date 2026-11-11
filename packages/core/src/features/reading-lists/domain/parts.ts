import { ValidationError } from "../../../shared/errors.js";
import type {
  Identifiable,
  IReadableRepository,
  IWritableRepository,
} from "../../../shared/parts.js";

// --- reading-list ---
/** Types for reading-list. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
export interface ReadingList extends Identifiable {
  id: string;
  name: string;
  description?: string;
  /** Parent list id for nesting; null/undefined = top level. */
  parentId?: string;
  sortOrder: number;
  color?: string;
  createdAt: string;
}

/** A paper or note membership in a list (the join row). Exactly one of paperId / vaultPageId. */
export interface ReadingListItem extends Identifiable {
  id: string;
  listId: string;
  paperId?: string;
  vaultPageId?: string;
  sortOrder: number;
  /** Why this item is in this list. */
  note?: string;
  /** Set when membership was propagated from a descendant list. */
  inheritedFromListId?: string;
  /** Marked during screening as a duplicate of another record in this list. */
  duplicateOfItemId?: string;
}

export interface NewReadingListInput {
  name: string;
  description?: string;
  parentId?: string;
  color?: string;
  sortOrder?: number;
}

export interface ReadingListFilter {
  /** Use `null` to select only top-level lists. */
  parentId?: string | null;
  /** Case-insensitive substring match against name. */
  nameContains?: string;
}

export interface ReadingListTreeNode {
  list: ReadingList;
  children: ReadingListTreeNode[];
}

export class ReadingListValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "ReadingListValidationError";
  }
}

// --- screening ---
/** Types for screening. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
/** The two passes of a screen. Full text is only reached by surviving the first. */
export type ScreeningStage = "title_abstract" | "full_text";

export const SCREENING_STAGES: readonly ScreeningStage[] = ["title_abstract", "full_text"];

/**
 * What one reviewer decided.
 *
 * `unsure` is a real answer rather than an absent one: "I could not tell from
 * the abstract" is the reason full-text screening exists, and collapsing it
 * into `excluded` drops the paper silently.
 */
export type ScreeningState = "included" | "excluded" | "unsure";

export interface ScreeningDecision extends Identifiable {
  id: string;
  /** The `reading_list_items` row -- this paper, in this review. */
  itemId: string;
  reviewerId: string;
  stage: ScreeningStage;
  state: ScreeningState;
  /** Why. Expected for an exclusion at full text; a PRISMA box asks for it. */
  reason?: string;
  decidedAt: string;
}

export class ScreeningError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "ScreeningError";
  }
}

/** Each item's latest decision per reviewer, per stage. */
interface LatestIndex {
  get(itemId: string, stage: ScreeningStage): Map<string, ScreeningDecision>;
  /** Items with any decision, in first-seen order. */
  itemIds(): Iterable<string>;
}

export interface ItemVerdict {
  itemId: string;
  stage: ScreeningStage;
  /** What the reviewers agree on, or null while they do not. */
  state: ScreeningState | null;
  /** True when reviewers recorded different states. */
  conflict: boolean;
  /** How many reviewers have answered at all. */
  answered: number;
}

export interface Agreement {
  /** The two reviewers compared, in the order given. */
  reviewers: [string, string];
  /** Items both of them screened at this stage. */
  compared: number;
  /** Items they answered identically. */
  agreed: number;
  /** `agreed / compared`, or null when they have screened nothing in common. */
  proportion: number | null;
  /**
   * Cohen's kappa: agreement past what their individual rates would produce by
   * chance. Null when there is nothing to compare, and null when chance
   * agreement is total -- both said "included" to everything, where kappa is
   * `0/0` and reporting 0 would read as "they never agree".
   */
  kappa: number | null;
}

type Pair = { a: ScreeningState; b: ScreeningState };

export interface PrismaCounts {
  /** Everything the searches turned up, before anything was thrown away. */
  identified: number;
  /** Records removed as duplicates of another record. */
  duplicates: number;
  /** What was left to screen on title and abstract. */
  screened: number;
  excludedAtScreening: number;
  /** Full texts sought and assessed. */
  eligible: number;
  excludedAtFullText: number;
  included: number;
  /** Items nobody has decided yet. Not a PRISMA box -- a warning about one. */
  undecided: number;
  /** Items where reviewers disagree. Also not a box, and also worth saying. */
  conflicts: number;
}

export interface ScreeningItem {
  /** The `reading_list_items` row id. */
  id: string;
  /** Marked as a duplicate of another record in the same list. */
  duplicateOfItemId?: string;
}

// --- parts ---
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
