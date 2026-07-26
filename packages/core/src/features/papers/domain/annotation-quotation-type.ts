import type { Identifiable } from "../../../shared/repository.js";

/** Citavi-style taxonomy for how an annotation will be used in writing. */
export type QuotationType = "direct" | "paraphrase" | "summary";

export const QUOTATION_TYPES: readonly QuotationType[] = [
  "direct",
  "paraphrase",
  "summary",
];

export const QUOTATION_TYPE_LABELS: Record<QuotationType, string> = {
  direct: "Direct",
  paraphrase: "Paraphrase",
  summary: "Summary",
};

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

export function isQuotationType(value: string): value is QuotationType {
  return (QUOTATION_TYPES as readonly string[]).includes(value);
}
