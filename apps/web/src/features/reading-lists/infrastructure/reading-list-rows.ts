import type { ReadingList, ReadingListItem } from "@weaveforge/core";
import { attachEncryptedRow, encryptedRowFields } from "@/lib/encrypted-row";
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
  content_enc: string | null;
  enc_epoch: number | null;
}

export interface ReadingListItemRow {
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

export function toListDomain(row: ReadingListRow): ReadingList {
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

export function toListRow(l: ReadingList): Record<string, unknown> {
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

export function toItemDomain(row: ReadingListItemRow): ReadingListItem {
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

export function toItemRow(i: ReadingListItem): Record<string, unknown> {
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
