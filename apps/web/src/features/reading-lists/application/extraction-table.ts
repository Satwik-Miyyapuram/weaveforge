import type { Paper, PaperFieldDef, PaperFieldValue, PaperFieldValueData } from "@thesis/core";
import { computeRollup } from "@thesis/core";

export type ExtractionColumnId = "title" | "year" | "status" | `field:${string}`;

export interface ExtractionRow {
  paper: Paper;
  values: Map<string, PaperFieldValueData>;
}

export function valueMapForPaper(
  paperId: string,
  allValues: readonly PaperFieldValue[],
  defs: readonly PaperFieldDef[] = [],
): Map<string, PaperFieldValueData> {
  const map = new Map<string, PaperFieldValueData>();
  for (const row of allValues) {
    if (row.paperId === paperId) map.set(row.fieldId, row.value);
  }
  for (const def of defs) {
    if (def.kind !== "rollup") continue;
    const computed = computeRollup(paperId, def, defs, allValues);
    if (computed != null) map.set(def.id, computed);
  }
  return map;
}

/** Unique papers in list order; ignores vault notes. */
export function flattenPaperRows(
  papers: readonly Paper[],
  paperIds: readonly string[],
  allValues: readonly PaperFieldValue[],
  defs: readonly PaperFieldDef[] = [],
): ExtractionRow[] {
  const byId = new Map(papers.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const rows: ExtractionRow[] = [];
  for (const id of paperIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const paper = byId.get(id);
    if (!paper) continue;
    rows.push({ paper, values: valueMapForPaper(id, allValues, defs) });
  }
  return rows;
}

export function formatCell(value: PaperFieldValueData | undefined): string {
  if (value == null) return "";
  return Array.isArray(value) ? value.join("; ") : String(value);
}

export function extractionMarkdown(
  rows: readonly ExtractionRow[],
  defs: readonly PaperFieldDef[],
  columns: readonly ExtractionColumnId[],
): string {
  const headers = columns.map((c) => columnLabel(c, defs));
  const sep = headers.map(() => "---");
  const body = rows.map((row) =>
    columns.map((c) => escapeMd(cellText(row, c))).join(" | "),
  );
  return [
    `| ${headers.join(" | ")} |`,
    `| ${sep.join(" | ")} |`,
    ...body.map((line) => `| ${line} |`),
  ].join("\n");
}

export function extractionCsv(
  rows: readonly ExtractionRow[],
  defs: readonly PaperFieldDef[],
  columns: readonly ExtractionColumnId[],
): string {
  const headers = columns.map((c) => columnLabel(c, defs));
  const body = rows.map((row) =>
    columns.map((c) => csvEscape(cellText(row, c))).join(","),
  );
  return [headers.map(csvEscape).join(","), ...body].join("\n");
}

export function columnLabel(column: ExtractionColumnId, defs: readonly PaperFieldDef[]): string {
  if (column === "title") return "Title";
  if (column === "year") return "Year";
  if (column === "status") return "Status";
  const fieldId = column.slice("field:".length);
  return defs.find((d) => d.id === fieldId)?.name ?? fieldId;
}

function cellText(row: ExtractionRow, column: ExtractionColumnId): string {
  if (column === "title") return row.paper.title;
  if (column === "year") return row.paper.year != null ? String(row.paper.year) : "";
  if (column === "status") return row.paper.status.replace("_", " ");
  return formatCell(row.values.get(column.slice("field:".length)));
}

function escapeMd(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
