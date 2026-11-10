/**
 * Paper, paper field and annotation quotation type row mapping (Rust `papers::paper_row`,
 * `papers::paper_field_row` and `papers::annotation_quotation_type_row`). The rows are the
 * tables' columns; the domain types are camelCase. The repositories that read and write them
 * stay in the web app.
 */
import {
  paperRowToDomain as rawPaperRowToDomain,
  paperRowToSummary as rawPaperRowToSummary,
  paperToRow as rawPaperToRow,
  emptyToNull as rawEmptyToNull,
  paperFieldDefRowToDomain as rawPaperFieldDefRowToDomain,
  paperFieldValueRowToDomain as rawPaperFieldValueRowToDomain,
  annotationQuotationTypeRowToDomain as rawAnnotationQuotationTypeRowToDomain,
} from "../pkg/wf_wasm.js";
import type {
  AnnotationQuotationType,
  AnnotationQuotationTypeRow,
  Paper,
  PaperFieldDef,
  PaperFieldDefRow,
  PaperFieldValue,
  PaperFieldValueRow,
  PaperRow,
  PaperSummary,
} from "./bindings.js";

/** A stored paper row as a domain paper. */
export function paperRowToDomain(row: PaperRow): Paper {
  return rawPaperRowToDomain(row) as Paper;
}

/** A stored paper row read with the card projection, as a summary. */
export function paperRowToSummary(row: PaperRow): PaperSummary {
  return rawPaperRowToSummary(row) as PaperSummary;
}

/** A domain paper as the row it is written as. */
export function paperToRow(paper: Paper): PaperRow {
  return rawPaperToRow(paper) as PaperRow;
}

/** The text, or `null` when it is absent or empty. */
export function emptyToNull(value: string | null | undefined): string | null {
  return rawEmptyToNull(value ?? undefined) as string | null;
}

/** A stored field definition row as a domain definition. */
export function paperFieldDefRowToDomain(row: PaperFieldDefRow): PaperFieldDef {
  return rawPaperFieldDefRowToDomain(row) as PaperFieldDef;
}

/** A stored field value row as a domain value. Throws on a payload that is not a string, number or string list. */
export function paperFieldValueRowToDomain(row: PaperFieldValueRow): PaperFieldValue {
  return rawPaperFieldValueRowToDomain(row) as PaperFieldValue;
}

/** A stored quotation type row as a domain value. Throws on an unknown quotation type. */
export function annotationQuotationTypeRowToDomain(
  row: AnnotationQuotationTypeRow,
): AnnotationQuotationType {
  return rawAnnotationQuotationTypeRowToDomain(row) as AnnotationQuotationType;
}
