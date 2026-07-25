import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildListTree,
  type IReadingListItemRepository,
  type IReadingListRepository,
  type ReadingList,
  type ReadingListFilter,
  type ReadingListItem,
  type ReadingListTreeNode,
} from "@thesis/core";
import type { ProjectContext } from "@/lib/project-context";
import {
  attachEncryptedRow,
  encryptedRowFields,
} from "@/lib/encrypted-row";

/**
 * Supabase implementations of the reading-list repositories.
 *
 * Persistence only (snake_case <-> camelCase). The tree is assembled by the
 * shared pure helper so it matches the in-memory implementation. Both classes
 * must pass the same contract suites.
 */

interface ReadingListRow {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  sort_order: number;
  color: string | null;
  created_at: string;
  content_enc: string | null;
  enc_epoch: number | null;
}

interface ReadingListItemRow {
  id: string;
  list_id: string;
  paper_id: string | null;
  vault_page_id: string | null;
  sort_order: number;
  note: string | null;
  inherited_from_list_id: string | null;
  content_enc: string | null;
  enc_epoch: number | null;
}

const LISTS = "reading_lists";
const ITEMS = "reading_list_items";

export class SupabaseReadingListRepository implements IReadingListRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly ctx: ProjectContext,
  ) {}
  private get pid() { return this.ctx.projectId; }

  async getById(id: string): Promise<ReadingList | null> {
    const { data, error } = await this.db
      .from(LISTS)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? toListDomain(data as ReadingListRow) : null;
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
    const { data, error } = await query;
    if (error) throw error;
    return (data as ReadingListRow[]).map(toListDomain);
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
    const { error } = await this.db.from(LISTS).upsert(row);
    if (error) throw error;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.db.from(LISTS).delete().eq("id", id);
    if (error) throw error;
  }
}

export class SupabaseReadingListItemRepository
  implements IReadingListItemRepository
{
  constructor(private readonly db: SupabaseClient) {}

  async listItems(listId: string): Promise<ReadingListItem[]> {
    const { data, error } = await this.db
      .from(ITEMS)
      .select("*")
      .eq("list_id", listId)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return (data as ReadingListItemRow[]).map(toItemDomain);
  }

  async listItemsForLists(listIds: readonly string[]): Promise<ReadingListItem[]> {
    if (listIds.length === 0) return [];
    const { data, error } = await this.db
      .from(ITEMS)
      .select("*")
      .in("list_id", listIds as string[])
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return (data as ReadingListItemRow[]).map(toItemDomain);
  }

  async listsForPaper(paperId: string): Promise<ReadingListItem[]> {
    const { data, error } = await this.db
      .from(ITEMS)
      .select("*")
      .eq("paper_id", paperId);
    if (error) throw error;
    return (data as ReadingListItemRow[]).map(toItemDomain);
  }

  async listsForNote(vaultPageId: string): Promise<ReadingListItem[]> {
    const { data, error } = await this.db
      .from(ITEMS)
      .select("*")
      .eq("vault_page_id", vaultPageId);
    if (error) throw error;
    return (data as ReadingListItemRow[]).map(toItemDomain);
  }

  async find(listId: string, paperId: string): Promise<ReadingListItem | null> {
    const { data, error } = await this.db
      .from(ITEMS)
      .select("*")
      .eq("list_id", listId)
      .eq("paper_id", paperId)
      .maybeSingle();
    if (error) throw error;
    return data ? toItemDomain(data as ReadingListItemRow) : null;
  }

  async findNote(listId: string, vaultPageId: string): Promise<ReadingListItem | null> {
    const { data, error } = await this.db
      .from(ITEMS)
      .select("*")
      .eq("list_id", listId)
      .eq("vault_page_id", vaultPageId)
      .maybeSingle();
    if (error) throw error;
    return data ? toItemDomain(data as ReadingListItemRow) : null;
  }

  async add(item: ReadingListItem): Promise<void> {
    const { error } = await this.db.from(ITEMS).upsert(toItemRow(item));
    if (error) throw error;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db.from(ITEMS).delete().eq("id", id);
    if (error) throw error;
  }
}

function toListDomain(row: ReadingListRow): ReadingList {
  return attachEncryptedRow(
    {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      parentId: row.parent_id ?? undefined,
      sortOrder: row.sort_order,
      color: row.color ?? undefined,
      createdAt: row.created_at,
    },
    row,
  );
}

function toListRow(l: ReadingList): Record<string, unknown> {
  return {
    id: l.id,
    name: l.name,
    description: l.description ?? null,
    parent_id: l.parentId ?? null,
    sort_order: l.sortOrder,
    color: l.color ?? null,
    created_at: l.createdAt,
    ...encryptedRowFields(l),
  };
}

function toItemDomain(row: ReadingListItemRow): ReadingListItem {
  return attachEncryptedRow(
    {
      id: row.id,
      listId: row.list_id,
      paperId: row.paper_id ?? undefined,
      vaultPageId: row.vault_page_id ?? undefined,
      sortOrder: row.sort_order,
      note: row.note ?? undefined,
      inheritedFromListId: row.inherited_from_list_id ?? undefined,
    },
    row,
  );
}

function toItemRow(i: ReadingListItem): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: i.id,
    list_id: i.listId,
    paper_id: i.paperId ?? null,
    vault_page_id: i.vaultPageId ?? null,
    sort_order: i.sortOrder,
    note: i.note ?? null,
    ...encryptedRowFields(i),
  };
  if (i.inheritedFromListId) row.inherited_from_list_id = i.inheritedFromListId;
  return row;
}
