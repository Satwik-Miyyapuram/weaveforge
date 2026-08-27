/**
 * Reading lists domain model — pure, no I/O, no SDK imports.
 *
 * A `ReadingList` is a named, nestable grouping of papers (e.g.
 * "Latent spaces > Disentanglement > β-VAE family"). Membership is modeled
 * separately as `ReadingListItem` (many-to-many with papers). One reason to
 * change: the rules of what a reading list *is* (SRP).
 */

import type { Identifiable } from "../../../shared/repository.js";
import type { Clock, IdGenerator } from "../../../shared/clock.js";
import { buildTree } from "../../../shared/tree.js";

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

export class ReadingListValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadingListValidationError";
  }
}

export function createReadingList(
  input: NewReadingListInput,
  deps: { clock: Clock; ids: IdGenerator },
): ReadingList {
  const name = input.name?.trim();
  if (!name) {
    throw new ReadingListValidationError("Reading list name is required.");
  }
  return {
    id: deps.ids.newId(),
    name,
    description: input.description,
    parentId: input.parentId,
    sortOrder: input.sortOrder ?? 0,
    color: input.color,
    createdAt: deps.clock.nowIso(),
  };
}

/**
 * Build the nested list tree from a flat array (pure). Shared by every
 * repository so `getTree()` is identical across implementations (Liskov).
 * Siblings ordered by `sortOrder`, then `name`.
 */
export function buildListTree(
  lists: readonly ReadingList[],
): ReadingListTreeNode[] {
  return buildTree(lists, {
    id: (list) => list.id,
    parentId: (list) => list.parentId,
    node: (list) => ({ list, children: [] }),
    compare: (a, b) =>
      a.list.sortOrder - b.list.sortOrder ||
      a.list.name.localeCompare(b.list.name),
  });
}
