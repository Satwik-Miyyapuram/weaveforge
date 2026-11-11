/**
 * Extraction-table rules (Rust `reading_lists::extraction_table`). Cell values with rollup
 * columns, markdown and CSV export, empty cells, the fill prompt and pending fills. The web
 * adapter in `apps/web/.../application/extraction-rows.ts` does the paper lookups.
 */
import type { ExtractionValues } from "./bindings.js";

export {
  buildProposeFillPrompt,
  emptyCellPaperIds,
  extractionCsv,
  extractionMarkdown,
  flattenPaperRows,
  pendingFieldFills,
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
