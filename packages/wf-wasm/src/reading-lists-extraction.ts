/**
 * Extraction-table rules (Rust `reading_lists::extraction_table`). Cell values with rollup
 * columns, markdown and CSV export, empty cells, the fill prompt and pending fills. The web
 * adapter in `apps/web/.../application/extraction-rows.ts` does the paper lookups.
 */
import {
  flattenPaperRows as rawFlattenPaperRows,
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

export {
  emptyCellPaperIds,
  extractionCsv,
  extractionMarkdown,
} from "../pkg/wf_wasm.js";

export {
  buildProposeFillPrompt,
} from "../pkg/wf_wasm.js";

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

/** A listed paper that exists: its index in `knownIds`, and its values keyed by field id. */
export interface FlatPaperRow {
  paperIndex: number;
  values: ExtractionValues["values"];
}

/**
 * The listed papers that exist, in list order, each once (first place). `knownIds` is the id of
 * every paper the caller holds, by position; a repeated id resolves to its last position.
 */
export function flattenPaperRows(
  knownIds: readonly string[],
  paperIds: readonly string[],
  values: readonly RollupValue[],
  defs: readonly ExtractionFieldDef[],
): FlatPaperRow[] {
  return rawFlattenPaperRows(knownIds, paperIds, values, defs) as FlatPaperRow[];
}

/** Pending `paper_field_value` proposals as cell fills, optionally for one field. */
export function pendingFieldFills(
  proposals: readonly ExtractionProposal[],
  fieldId?: string,
): ExtractionPendingFill[] {
  return rawPendingFieldFills(proposals, fieldId) as ExtractionPendingFill[];
}
