import type { Identifiable } from "../../../shared/repository.js";

/** Citavi-style taxonomy for how an annotation will be used in writing. */
export type QuotationType = "direct" | "paraphrase" | "summary";

/** Project-scoped quotation type for a Zotero annotation key. */
export interface AnnotationQuotationType extends Identifiable {
  id: string;
  paperId: string;
  annotationKey: string;
  quotationType: QuotationType;
  createdAt: string;
  updatedAt: string;
}

export interface SaveAnnotationQuotationTypeInput {
  paperId: string;
  annotationKey: string;
  quotationType: QuotationType;
}
