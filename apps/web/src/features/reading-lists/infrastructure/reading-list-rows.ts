import type { ReadingList, ReadingListItem } from "@weaveforge/core";
/**
 * How reading list rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers. They talk to the *same* table — one through
 * supabase-js, the other through `pg` — so the column shape and the mapping are
 * not per-provider facts, and holding two copies of them is how they drift.
 */

export interface ReadingListRow {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  sort_order: number;
  color: string | null;
  created_at: string;
}

export interface ReadingListItemRow {
  id: string;
  list_id: string;
  paper_id: string | null;
  vault_page_id: string | null;
  sort_order: number;
  note: string | null;
  inherited_from_list_id: string | null;
  duplicate_of_item_id?: string | null;
}

export function toListDomain(row: ReadingListRow): ReadingList {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    parentId: row.parent_id ?? undefined,
    sortOrder: row.sort_order,
    color: row.color ?? undefined,
    createdAt: row.created_at,
  };
}

export function toListRow(l: ReadingList): Record<string, unknown> {
  return {
    id: l.id,
    name: l.name,
    description: l.description ?? null,
    parent_id: l.parentId ?? null,
    sort_order: l.sortOrder,
    color: l.color ?? null,
    created_at: l.createdAt,
  };
}

export function toItemDomain(row: ReadingListItemRow): ReadingListItem {
  return {
    id: row.id,
    listId: row.list_id,
    paperId: row.paper_id ?? undefined,
    vaultPageId: row.vault_page_id ?? undefined,
    sortOrder: row.sort_order,
    note: row.note ?? undefined,
    inheritedFromListId: row.inherited_from_list_id ?? undefined,
    duplicateOfItemId: row.duplicate_of_item_id ?? undefined,
  };
}

export function toItemRow(i: ReadingListItem): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: i.id,
    list_id: i.listId,
    paper_id: i.paperId ?? null,
    vault_page_id: i.vaultPageId ?? null,
    sort_order: i.sortOrder,
    note: i.note ?? null,
  };
  if (i.inheritedFromListId) row.inherited_from_list_id = i.inheritedFromListId;
  if (i.duplicateOfItemId) row.duplicate_of_item_id = i.duplicateOfItemId;
  return row;
}
