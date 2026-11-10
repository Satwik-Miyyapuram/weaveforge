/**
 * Extraction-table rules (Rust `reading_lists::extraction_table`). Cell values with rollup
 * columns, markdown and CSV export, empty cells, the fill prompt and pending fills. The web
 * adapter in `apps/web/.../application/extraction-rows.ts` does the paper lookups.
 */
import {
  extractionValueRows as rawExtractionValueRows,
  extractionMarkdown as rawExtractionMarkdown,
  extractionCsv as rawExtractionCsv,
  emptyCellPaperIds as rawEmptyCellPaperIds,
  buildProposeFillPrompt as rawBuildProposeFillPrompt,
  pendingFieldFills as rawPendingFieldFills,
} from "../pkg/wf_wasm.js";
import type {
  ExtractionFieldDef,
  ExtractionPendingFill,
  ExtractionProposal,
  ExtractionRow,
  ExtractionValues,
  ProposeFillInput,
  RollupValue,
} from "./bindings.js";

export type {
  ExtractionFieldDef,
  ExtractionPaper,
  ExtractionPendingFill,
  ExtractionProposal,
  ExtractionRow,
  ExtractionValues,
  FillPaper,
  ProposeFillInput,
} from "./bindings.js";

/** Each listed paper's stored and rollup values, keyed by field id, in list order. */
export function extractionValueRows(
  paperIds: readonly string[],
  values: readonly RollupValue[],
  defs: readonly ExtractionFieldDef[],
): ExtractionValues[] {
  return rawExtractionValueRows(paperIds, values, defs) as ExtractionValues[];
}

/** The table as a Markdown table over `columns` (`title`, `year`, `status`, `field:<id>`). */
export function extractionMarkdown(
  rows: readonly ExtractionRow[],
  defs: readonly ExtractionFieldDef[],
  columns: readonly string[],
): string {
  return rawExtractionMarkdown(rows, defs, columns);
}

/** The table as CSV over `columns`, with a header line. */
export function extractionCsv(
  rows: readonly ExtractionRow[],
  defs: readonly ExtractionFieldDef[],
  columns: readonly string[],
): string {
  return rawExtractionCsv(rows, defs, columns);
}

/** Papers whose `fieldId` cell is empty and not in `pendingPaperIds`, in row order. */
export function emptyCellPaperIds(
  rows: readonly ExtractionRow[],
  fieldId: string,
  pendingPaperIds: readonly string[],
): string[] {
  return rawEmptyCellPaperIds(rows, fieldId, pendingPaperIds) as string[];
}

/** The prompt that asks the AI to fill one extraction column. */
export function buildProposeFillPrompt(input: ProposeFillInput): string {
  return rawBuildProposeFillPrompt(input);
}

/** Pending `paper_field_value` proposals as cell fills, optionally for one field. */
export function pendingFieldFills(
  proposals: readonly ExtractionProposal[],
  fieldId?: string,
): ExtractionPendingFill[] {
  return rawPendingFieldFills(proposals, fieldId) as ExtractionPendingFill[];
}
