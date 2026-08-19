import type {
  AnnotationPin,
} from "@weaveforge/core";

/**
 * How annotation pin rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers. They talk to the *same* table — one through
 * supabase-js, the other through `pg` — so the column shape and the mapping are
 * not per-provider facts, and holding two copies of them is how they drift.
 */

export interface AnnotationPinRow {
  id: string;
  paper_id: string;
  annotation_key: string;
  report_section_id: string;
  created_at: string;
}

export function toDomain(row: AnnotationPinRow): AnnotationPin {
  return {
    id: row.id,
    paperId: row.paper_id,
    annotationKey: row.annotation_key,
    reportSectionId: row.report_section_id,
    createdAt: row.created_at,
  };
}
