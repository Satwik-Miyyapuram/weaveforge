import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildListTree,
  type IReadingListItemRepository,
  type IReadingListRepository,
  type ReadingList,
  type ReadingListFilter,
  type ReadingListItem,
  type ReadingListTreeNode,
} from "@weaveforge/core";
import {
  type ReadingListRow,
  type ReadingListItemRow,
  toListDomain,
  toListRow,
  toItemDomain,
  toItemRow,
} from "./reading-list-rows";
import { one, rows, run } from "@/backend/providers/supabase/row-access";
import { ProjectRepository } from "@/backend/providers/supabase/project-scoped-repository";

/**
 * Supabase implementations of the reading-list repositories.
 *
 * Persistence only (snake_case <-> camelCase). The tree is assembled by the
 * shared pure helper so it matches the in-memory implementation. Both classes
 * must pass the same contract suites.
 */

const LISTS = "reading_lists";
const ITEMS = "reading_list_items";

export class SupabaseReadingListRepository extends ProjectRepository implements IReadingListRepository {

  async getById(id: string): Promise<ReadingList | null> {
    const row = await one<ReadingListRow>(this.db
      .from(LISTS)
      .select("*")
      .eq("id", id)
      .maybeSingle());
    return row ? toListDomain(row) : null;
  }

  async list(filter?: ReadingListFilter): Promise<ReadingList[]> {
    let query = this.db.from(LISTS).select("*");
    if (this.pid) query = query.eq("project_id", this.pid);
    if (filter?.parentId !== undefined) {
      query =
        filter.parentId === null
          ? query.is("parent_id", null)
          : query.eq("parent_id", filter.parentId);
    }
    if (filter?.nameContains) {
      // Server ilike removed under E2EE — encryptRepo filters client-side post-decrypt.
    }
    query = query.order("sort_order", { ascending: true }).order("name");
    return (await rows<ReadingListRow>(query)).map(toListDomain);
  }

  async getTree(): Promise<ReadingListTreeNode[]> {
    let q = this.db.from(LISTS).select("*");
    if (this.pid) q = q.eq("project_id", this.pid);
    const { data, error } = await q;
    if (error) throw error;
    return buildListTree((data as ReadingListRow[]).map(toListDomain));
  }

  async save(entity: ReadingList): Promise<void> {
    const row = toListRow(entity);
    if (this.pid) row.project_id = this.pid;
    await run(this.db.from(LISTS).upsert(row));
  }

  async delete(id: string): Promise<void> {
    await run(this.db.from(LISTS).delete().eq("id", id));
  }
}

export class SupabaseReadingListItemRepository
  implements IReadingListItemRepository
{
  constructor(private readonly db: SupabaseClient) {}

  async listItems(listId: string): Promise<ReadingListItem[]> {
    return (await rows<ReadingListItemRow>(this.db
      .from(ITEMS)
      .select("*")
      .eq("list_id", listId)
      .order("sort_order", { ascending: true }))).map(toItemDomain);
  }

  async listItemsForLists(listIds: readonly string[]): Promise<ReadingListItem[]> {
    if (listIds.length === 0) return [];
    return (await rows<ReadingListItemRow>(this.db
      .from(ITEMS)
      .select("*")
      .in("list_id", listIds as string[])
      .order("sort_order", { ascending: true }))).map(toItemDomain);
  }

  async listsForPaper(paperId: string): Promise<ReadingListItem[]> {
    return (await rows<ReadingListItemRow>(this.db
      .from(ITEMS)
      .select("*")
      .eq("paper_id", paperId))).map(toItemDomain);
  }

  async listsForNote(vaultPageId: string): Promise<ReadingListItem[]> {
    return (await rows<ReadingListItemRow>(this.db
      .from(ITEMS)
      .select("*")
      .eq("vault_page_id", vaultPageId))).map(toItemDomain);
  }

  async find(listId: string, paperId: string): Promise<ReadingListItem | null> {
    const row = await one<ReadingListItemRow>(this.db
      .from(ITEMS)
      .select("*")
      .eq("list_id", listId)
      .eq("paper_id", paperId)
      .maybeSingle());
    return row ? toItemDomain(row) : null;
  }

  async findNote(listId: string, vaultPageId: string): Promise<ReadingListItem | null> {
    const row = await one<ReadingListItemRow>(this.db
      .from(ITEMS)
      .select("*")
      .eq("list_id", listId)
      .eq("vault_page_id", vaultPageId)
      .maybeSingle());
    return row ? toItemDomain(row) : null;
  }

  async add(item: ReadingListItem): Promise<void> {
    await run(this.db.from(ITEMS).upsert(toItemRow(item)));
  }

  async remove(id: string): Promise<void> {
    await run(this.db.from(ITEMS).delete().eq("id", id));
  }
}

