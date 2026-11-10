import type { AiWriteProposal, Paper, PaperFieldDef, PaperFieldValue, PaperFieldValueData } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";

/** Table rules live in wf-core (`reading_lists::extraction_table`); this file adapts them. */

export type ExtractionColumnId = "title" | "year" | "status" | `field:${string}`;

export interface ExtractionRow {
  paper: Paper;
  values: Map<string, PaperFieldValueData>;
}

export interface PendingFieldFill {
  proposalId: string;
  paperId: string;
  fieldId: string;
  preview: string;
}

/** A relation or rollup cell's papers, by title (the id when the paper is gone; wf-core `extraction_keys`). */
export function relationTitles(ids: readonly unknown[], titleById: ReadonlyMap<string, string>): string {
  return readyCore().relationTitles(ids.map(String), titleById);
}

type CoreRows = Parameters<ReturnType<typeof readyCore>["extractionMarkdown"]>[0];

function toCoreRows(rows: readonly ExtractionRow[]): CoreRows {
  return rows.map((row) => ({
    paper: {
      id: row.paper.id,
      title: row.paper.title,
      year: row.paper.year ?? null,
      status: row.paper.status,
    },
    values: Object.fromEntries(row.values),
  })) as CoreRows;
}

type WasmFieldValues = ReturnType<ReturnType<typeof readyCore>["flattenPaperRows"]>[number]["values"];

/** Bindings type f64 as number | null (NaN/Infinity serialise as null); field values are always finite. */
function toDomainValues(values: WasmFieldValues): Map<string, PaperFieldValueData> {
  return new Map(Object.entries(values)) as Map<string, PaperFieldValueData>;
}

/**
 * Unique papers in list order; ignores vault notes. Wf-core decides which listed papers exist and
 * their order; this maps each returned index back to the paper object. Rollups: one wasm call.
 */
export function flattenPaperRows(
  papers: readonly Paper[],
  paperIds: readonly string[],
  allValues: readonly PaperFieldValue[],
  defs: readonly PaperFieldDef[] = [],
): ExtractionRow[] {
  const computed = readyCore().flattenPaperRows(
    papers.map((p) => p.id),
    paperIds,
    allValues,
    defs,
  );
  return computed.flatMap(({ paperIndex, values }) => {
    const paper = papers[paperIndex];
    return paper ? [{ paper, values: toDomainValues(values) }] : [];
  });
}

export function extractionMarkdown(
  rows: readonly ExtractionRow[],
  defs: readonly PaperFieldDef[],
  columns: readonly ExtractionColumnId[],
): string {
  return readyCore().extractionMarkdown(toCoreRows(rows), defs, columns);
}

export function extractionCsv(
  rows: readonly ExtractionRow[],
  defs: readonly PaperFieldDef[],
  columns: readonly ExtractionColumnId[],
): string {
  return readyCore().extractionCsv(toCoreRows(rows), defs, columns);
}

/** Papers whose cell for this field is empty and not already pending review. */
export function emptyCellPaperIds(
  rows: readonly ExtractionRow[],
  fieldId: string,
  pendingPaperIds: readonly string[],
): string[] {
  return readyCore().emptyCellPaperIds(toCoreRows(rows), fieldId, pendingPaperIds);
}

export function buildProposeFillPrompt(input: {
  listId: string;
  fieldId: string;
  fieldName: string;
  papers: readonly { id: string; title: string }[];
}): string {
  return readyCore().buildProposeFillPrompt({ ...input, papers: [...input.papers] });
}

