/**
 * Use-cases for reading lists and membership.
 *
 * Orchestration only (DIP): coordinate the domain factory and the two
 * repositories. Business rules here: a list needs a name; adding a paper or
 * note to a list is idempotent (dedupe by list+ref, matching the DB unique
 * constraint).
 */

import {
  createReadingList,
  ReadingListValidationError,
  type NewReadingListInput,
  type ReadingList,
  type ReadingListItem,
} from "../domain/reading-list.js";
import type {
  IReadingListItemRepository,
  IReadingListRepository,
} from "../domain/reading-list-repository.js";
import type { Clock, IdGenerator } from "../../../shared/clock.js";

export interface ManageReadingListDeps {
  lists: IReadingListRepository;
  items: IReadingListItemRepository;
  clock: Clock;
  ids: IdGenerator;
}

export class ManageReadingListUseCase {
  constructor(private readonly deps: ManageReadingListDeps) {}

  async createList(input: NewReadingListInput): Promise<ReadingList> {
    const list = createReadingList(input, {
      clock: this.deps.clock,
      ids: this.deps.ids,
    });
    await this.deps.lists.save(list);
    return list;
  }

  /** Add a paper to a list and every ancestor list. Idempotent per list. */
  async addPaperToList(
    listId: string,
    paperId: string,
    note?: string,
  ): Promise<ReadingListItem> {
    if (!listId || !paperId) {
      throw new ReadingListValidationError("listId and paperId are required.");
    }

    const targets = [listId, ...(await this.ancestorListIds(listId))];
    let primary: ReadingListItem | null = null;
    for (const targetId of targets) {
      const item = await this.addPaperToListOne(
        targetId,
        paperId,
        targetId === listId ? note : undefined,
        targetId === listId ? undefined : listId,
      );
      if (targetId === listId) primary = item;
    }
    return primary!;
  }

  /** Add a note to a list and every ancestor list. Idempotent per list. */
  async addNoteToList(
    listId: string,
    vaultPageId: string,
    note?: string,
  ): Promise<ReadingListItem> {
    if (!listId || !vaultPageId) {
      throw new ReadingListValidationError("listId and vaultPageId are required.");
    }

    const targets = [listId, ...(await this.ancestorListIds(listId))];
    let primary: ReadingListItem | null = null;
    for (const targetId of targets) {
      const item = await this.addNoteToListOne(
        targetId,
        vaultPageId,
        targetId === listId ? note : undefined,
        targetId === listId ? undefined : listId,
      );
      if (targetId === listId) primary = item;
    }
    return primary!;
  }

  /** Persist a new paper order for one list. */
  async reorderPapers(listId: string, orderedPaperIds: readonly string[]): Promise<void> {
    const items = await this.deps.items.listItems(listId);
    const orderedItemIds = orderedPaperIds.map((paperId) => {
      const item = items.find((i) => i.paperId === paperId);
      if (!item) throw new ReadingListValidationError(`Paper ${paperId} is not in list ${listId}.`);
      return item.id;
    });
    await this.reorderItems(listId, orderedItemIds);
  }

  /** Persist a new mixed item order for one list. */
  async reorderItems(listId: string, orderedItemIds: readonly string[]): Promise<void> {
    if (!listId) throw new ReadingListValidationError("listId is required.");
    const items = await this.deps.items.listItems(listId);
    if (orderedItemIds.length !== items.length) {
      throw new ReadingListValidationError(
        `orderedItemIds must include every item in list ${listId}.`,
      );
    }
    const seen = new Set<string>();
    for (const id of orderedItemIds) {
      if (seen.has(id)) {
        throw new ReadingListValidationError(
          `orderedItemIds contains duplicates for list ${listId}.`,
        );
      }
      seen.add(id);
    }
    for (const item of items) {
      if (!seen.has(item.id)) {
        throw new ReadingListValidationError(
          `orderedItemIds is missing item ${item.id} for list ${listId}.`,
        );
      }
    }
    const byId = new Map(items.map((i) => [i.id, i]));
    for (let i = 0; i < orderedItemIds.length; i++) {
      const itemId = orderedItemIds[i]!;
      const item = byId.get(itemId);
      if (!item || item.sortOrder === i) continue;
      await this.deps.items.add({ ...item, sortOrder: i });
    }
  }

  async removePaperFromList(listId: string, paperId: string): Promise<void> {
    const existing = await this.deps.items.find(listId, paperId);
    if (existing) await this.deps.items.remove(existing.id);

    const memberships = await this.deps.items.listsForPaper(paperId);
    for (const item of memberships) {
      if (item.inheritedFromListId === listId) {
        await this.deps.items.remove(item.id);
      }
    }
  }

  async removeNoteFromList(listId: string, vaultPageId: string): Promise<void> {
    const existing = await this.deps.items.findNote(listId, vaultPageId);
    if (existing) await this.deps.items.remove(existing.id);

    const memberships = await this.deps.items.listsForNote(vaultPageId);
    for (const item of memberships) {
      if (item.inheritedFromListId === listId) {
        await this.deps.items.remove(item.id);
      }
    }
  }

  /** Delete a list, its items, and nested sublists (deepest first). */
  async removeList(listId: string): Promise<void> {
    if (!listId) throw new ReadingListValidationError("listId is required.");
    const list = await this.deps.lists.getById(listId);
    if (!list) throw new ReadingListValidationError(`List ${listId} not found.`);

    const all = await this.deps.lists.list();
    for (const child of all.filter((l) => l.parentId === listId)) {
      await this.removeList(child.id);
    }
    for (const item of await this.deps.items.listItems(listId)) {
      await this.deps.items.remove(item.id);
    }
    await this.deps.lists.delete(listId);
  }

  /** Walk parentId links from listId up to the root. */
  private async ancestorListIds(listId: string): Promise<string[]> {
    const ancestors: string[] = [];
    let current = await this.deps.lists.getById(listId);
    while (current?.parentId) {
      ancestors.push(current.parentId);
      current = await this.deps.lists.getById(current.parentId);
    }
    return ancestors;
  }

  private async addPaperToListOne(
    listId: string,
    paperId: string,
    note?: string,
    inheritedFromListId?: string,
  ): Promise<ReadingListItem> {
    const existing = await this.deps.items.find(listId, paperId);
    if (existing) return existing;

    const siblings = await this.deps.items.listItems(listId);
    const sortOrder =
      siblings.length === 0
        ? 0
        : Math.max(...siblings.map((i) => i.sortOrder)) + 1;

    const item: ReadingListItem = {
      id: this.deps.ids.newId(),
      listId,
      paperId,
      sortOrder,
      note,
      inheritedFromListId,
    };
    try {
      await this.deps.items.add(item);
    } catch (err) {
      if (!inheritedFromListId) throw err;
      await this.deps.items.add({ ...item, inheritedFromListId: undefined });
      return { ...item, inheritedFromListId: undefined };
    }
    return item;
  }

  private async addNoteToListOne(
    listId: string,
    vaultPageId: string,
    note?: string,
    inheritedFromListId?: string,
  ): Promise<ReadingListItem> {
    const existing = await this.deps.items.findNote(listId, vaultPageId);
    if (existing) return existing;

    const siblings = await this.deps.items.listItems(listId);
    const sortOrder =
      siblings.length === 0
        ? 0
        : Math.max(...siblings.map((i) => i.sortOrder)) + 1;

    const item: ReadingListItem = {
      id: this.deps.ids.newId(),
      listId,
      vaultPageId,
      sortOrder,
      note,
      inheritedFromListId,
    };
    try {
      await this.deps.items.add(item);
    } catch (err) {
      if (!inheritedFromListId) throw err;
      await this.deps.items.add({ ...item, inheritedFromListId: undefined });
      return { ...item, inheritedFromListId: undefined };
    }
    return item;
  }
}
