/** Types for reading-list. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { Identifiable } from "../../../shared/repository.js";
import type { Clock, IdGenerator } from "../../../shared/clock.js";
import { ValidationError } from "../../../shared/errors.js";

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

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface ReadingListFns {
  createReadingList(input: NewReadingListInput, deps: { clock: Clock; ids: IdGenerator }): ReadingList;
  /**
 * Build the nested list tree from a flat array (pure). Shared by every
 * repository so `getTree()` is identical across implementations (Liskov).
 * Siblings ordered by `sortOrder`, then `name`.
 */
  buildListTree(lists: readonly ReadingList[]): ReadingListTreeNode[];
}
