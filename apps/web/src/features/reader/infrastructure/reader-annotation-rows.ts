import { isReaderAnnotationType, isAnnotationSyncState, type CombinedPdfAnchor, type ReaderAnnotation, type ReaderAnnotationType } from "@weaveforge/core";

/**
 * How reader annotation rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers. They talk to the *same* table — one through
 * supabase-js, the other through `pg` — so the column shape and the mapping are
 * not per-provider facts, and holding two copies of them is how they drift.
 */

export interface ReaderAnnotationRow {
  id: string;
  paper_id: string;
  origin: "local" | "zotero";
  zotero_key: string | null;
  type: string;
  color: string;
  text: string;
  comment: string;
  tags: string[] | null;
  anchor: CombinedPdfAnchor;
  page_index: number;
  sort_index: string;
  sync_state?: string | null;
  zotero_version?: number | null;
  created_at: string;
  updated_at: string;
}

export function toDomain(row: ReaderAnnotationRow): ReaderAnnotation {
  if (!isReaderAnnotationType(row.type)) {
    throw new Error(`Invalid annotation type in store: ${row.type}`);
  }
  return {
    id: row.id,
    origin: row.origin,
    zoteroKey: row.zotero_key,
    type: row.type as ReaderAnnotationType,
    color: row.color,
    text: row.text,
    comment: row.comment,
    tags: row.tags ?? [],
    anchor: row.anchor ?? {},
    sortIndex: row.sort_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncState: row.sync_state && isAnnotationSyncState(row.sync_state) ? row.sync_state : "local",
    zoteroVersion: row.zotero_version ?? null,
  };
}
