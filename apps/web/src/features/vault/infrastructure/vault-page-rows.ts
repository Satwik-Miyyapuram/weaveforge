import { type VaultPage } from "@weaveforge/core";
/**
 * How vault page rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers. They talk to the *same* table — one through
 * supabase-js, the other through `pg` — so the column shape and the mapping are
 * not per-provider facts, and holding two copies of them is how they drift.
 */

export interface VaultPageRow {
  id: string;
  title: string;
  body?: string | null;
  body_preview?: string | null;
  parent_id: string | null;
  /** Absent on a row read before migration 0136. */
  pinned?: boolean | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export function toDomain(row: VaultPageRow): VaultPage {
  return {
    id: row.id,
    title: row.title,
    body: row.body ?? "",
    parentId: row.parent_id ?? undefined,
    pinned: row.pinned === true,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toSummaryDomain(row: VaultPageRow): VaultPage {
  return {
    id: row.id,
    title: row.title,
    body: "",
    bodyPreview: row.body_preview ?? "",
    parentId: row.parent_id ?? undefined,
    pinned: row.pinned === true,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The row a page is written as.
 *
 * `updated_at` is deliberately absent. It is the server's column — migration
 * `0128` attaches `set_updated_at()` to `vault_pages`, and it was sent from
 * here until now, which meant the value was whatever the client last had in
 * memory. That value can go *backwards*: a second device with a slow clock, or
 * a client echoing the timestamp it read, writes an edit dated before the one
 * it supersedes. `listStamps()` reads this column to decide which pages a
 * client must refetch, so an edit dated into the past is an edit the delta read
 * never reports. Letting the column default fill it on insert and the trigger
 * own it on update is the same rule the other timestamped tables already have.
 *
 * `created_at` stays: it is not a freshness signal but a fact about when the
 * page was authored, and an offline client that made the page an hour ago is
 * the authority on that. `updated_at` is a statement about the *stored* row, so
 * only the store can make it.
 */
export function toRow(p: VaultPage): Record<string, unknown> {
  return {
    id: p.id,
    title: p.title,
    body: p.body ?? "",
    parent_id: p.parentId ?? null,
    pinned: p.pinned === true,
    sort_order: p.sortOrder,
    created_at: p.createdAt,
  };
}
