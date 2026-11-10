/**
 * Paper, paper field and annotation quotation type row mapping (Rust `papers::paper_row`,
 * `papers::paper_field_row` and `papers::annotation_quotation_type_row`). The rows are the
 * tables' columns; the domain types are camelCase. The repositories that read and write them
 * stay in the web app.
 */
import {
  emptyToNull as rawEmptyToNull,
} from "../pkg/wf_wasm.js";
import type {
  Paper,
} from "./bindings.js";

export {
  annotationQuotationTypeRowToDomain,
  paperFieldDefRowToDomain,
  paperFieldValueRowToDomain,
  paperRowToDomain,
  paperRowToSummary,
  paperToRow,
} from "../pkg/wf_wasm.js";

/** The text, or `null` when it is absent or empty. */
export function emptyToNull(value: string | null | undefined): string | null {
  return rawEmptyToNull(value ?? undefined) as string | null;
}

