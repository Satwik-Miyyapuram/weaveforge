/**
 * In-memory implementations of the reading-list repositories.
 *
 * Reference implementations for tests and the Liskov substitutability contract.
 */

import {
  buildListTree,
  type ReadingList,
  type ReadingListFilter,
  type ReadingListItem,
  type ReadingListTreeNode,
} from "../features/reading-lists/domain/reading-list.js";
import type {
  IReadingListItemRepository,
  IReadingListRepository,
} from "../features/reading-lists/domain/reading-list-repository.js";

export class InMemoryReadingListRepository implements IReadingListRepository {
  private readonly store = new Map<string, ReadingList>();

  async getById(id: string): Promise<ReadingList | null> {
    return this.store.get(id) ?? null;
  }

  async list(filter?: ReadingListFilter): Promise<ReadingList[]> {
    let items = [...this.store.values()];
    if (filter?.parentId !== undefined) {
      const target = filter.parentId ?? undefined;
      items = items.filter((l) => (l.parentId ?? undefined) === target);
    }
    if (filter?.nameContains) {
      const needle = filter.nameContains.toLowerCase();
      items = items.filter((l) => l.name.toLowerCase().includes(needle));
    }
    return items.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    );
  }

  async getTree(): Promise<ReadingListTreeNode[]> {
    return buildListTree([...this.store.values()]);
  }

  async save(entity: ReadingList): Promise<void> {
    this.store.set(entity.id, { ...entity });
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}

export class InMemoryReadingListItemRepository
  implements IReadingListItemRepository
{
  private readonly store = new Map<string, ReadingListItem>();

  async listItems(listId: string): Promise<ReadingListItem[]> {
    return [...this.store.values()]
      .filter((i) => i.listId === listId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async listItemsForLists(listIds: readonly string[]): Promise<ReadingListItem[]> {
    const set = new Set(listIds);
    return [...this.store.values()]
      .filter((i) => set.has(i.listId))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async listsForPaper(paperId: string): Promise<ReadingListItem[]> {
    return [...this.store.values()].filter((i) => i.paperId === paperId);
  }

  async listsForNote(vaultPageId: string): Promise<ReadingListItem[]> {
    return [...this.store.values()].filter((i) => i.vaultPageId === vaultPageId);
  }

  async find(listId: string, paperId: string): Promise<ReadingListItem | null> {
    for (const i of this.store.values()) {
      if (i.listId === listId && i.paperId === paperId) return i;
    }
    return null;
  }

  async findNote(listId: string, vaultPageId: string): Promise<ReadingListItem | null> {
    for (const i of this.store.values()) {
      if (i.listId === listId && i.vaultPageId === vaultPageId) return i;
    }
    return null;
  }

  async add(item: ReadingListItem): Promise<void> {
    this.store.set(item.id, { ...item });
  }

  async remove(id: string): Promise<void> {
    this.store.delete(id);
  }
}
