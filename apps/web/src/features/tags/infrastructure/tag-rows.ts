import type {
  Tag,
  PaperTag,
  TagSource,
} from "@weaveforge/core";

/**
 * How tag rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers. They talk to the *same* table — one through
 * supabase-js, the other through `pg` — so the column shape and the mapping are
 * not per-provider facts, and holding two copies of them is how they drift.
 */

export interface TagRow {
  id: string;
  name: string;
  color: string | null;
}

export interface PaperTagRow {
  paper_id: string;
  tag_id: string;
  source: string;
  annotation_ref: string | null;
}

export function toTagDomain(row: TagRow): Tag {
  return { id: row.id, name: row.name, color: row.color ?? undefined };
}

export function toPaperTagDomain(row: PaperTagRow): PaperTag {
  return {
    paperId: row.paper_id,
    tagId: row.tag_id,
    source: row.source as TagSource,
    annotationRef: row.annotation_ref ?? undefined,
  };
}
