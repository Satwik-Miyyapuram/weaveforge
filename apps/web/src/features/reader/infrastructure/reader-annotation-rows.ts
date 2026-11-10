import { type ReaderAnnotation } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";
import type { CombinedPdfAnchor } from "@weaveforge/wasm";

/**
 * How reader annotation rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers. They talk to the *same* table — one through
 * supabase-js, the other through `pg` — so the column shape and the mapping are
 * not per-provider facts, and holding two copies of them is how they drift.
 * The mapping itself is Rust (`reader::annotation_rows`), reached through wasm.
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
  return readyCore().annotationRowToDomain({
    ...row,
    sync_state: row.sync_state ?? null,
    zotero_version: row.zotero_version ?? null,
  }) as ReaderAnnotation; // Rust keeps the row's origin and type, which the row type already narrows.
}
