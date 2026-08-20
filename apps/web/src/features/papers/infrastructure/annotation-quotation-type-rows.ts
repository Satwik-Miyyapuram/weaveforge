import { isQuotationType, type AnnotationQuotationType, type QuotationType } from "@weaveforge/core";

/**
 * How annotation quotation type rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers. They talk to the *same* table — one through
 * supabase-js, the other through `pg` — so the column shape and the mapping are
 * not per-provider facts, and holding two copies of them is how they drift.
 */

export interface AnnotationQuotationTypeRow {
  id: string;
  paper_id: string;
  annotation_key: string;
  quotation_type: string;
  created_at: string;
  updated_at: string;
}

export function toDomain(row: AnnotationQuotationTypeRow): AnnotationQuotationType {
  if (!isQuotationType(row.quotation_type)) {
    throw new Error(`Invalid quotation type in store: ${row.quotation_type}`);
  }
  return {
    id: row.id,
    paperId: row.paper_id,
    annotationKey: row.annotation_key,
    quotationType: row.quotation_type as QuotationType,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
