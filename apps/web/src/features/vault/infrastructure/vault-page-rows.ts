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
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toRow(p: VaultPage): Record<string, unknown> {
  return {
    id: p.id,
    title: p.title,
    body: p.body ?? "",
    parent_id: p.parentId ?? null,
    sort_order: p.sortOrder,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}
