import type { QuotationType } from "@weaveforge/core";

/** Quotation types in the order the pickers list them. */
export const QUOTATION_TYPES: readonly QuotationType[] = ["direct", "paraphrase", "summary"];

/** Display label for each quotation type, shared by the paper and reader annotation lists. */
export const QUOTATION_TYPE_LABELS: Record<QuotationType, string> = {
  direct: "Direct",
  paraphrase: "Paraphrase",
  summary: "Summary",
};
