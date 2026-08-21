import type { AiWriteProposal, Paper, PaperFieldDef, PaperFieldValue, PaperFieldValueData } from "@weaveforge/core";
import { computeRollup } from "@weaveforge/core";

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

/** Join pending AI proposals onto extraction cells (Option B test helper + live overlay). */
export function pendingFieldFills(
  proposals: readonly AiWriteProposal[],
  fieldId?: string,
): PendingFieldFill[] {
  const out: PendingFieldFill[] = [];
  for (const proposal of proposals) {
    if (proposal.kind !== "paper_field_value" || proposal.status !== "pending") continue;
    const payload = proposal.payload;
    if (!payload || typeof payload !== "object") continue;
    const paperId =
      typeof payload.paperId === "string" && payload.paperId.trim()
        ? payload.paperId.trim()
        : proposal.resourceId;
    const fid = typeof payload.fieldId === "string" ? payload.fieldId.trim() : "";
    if (!paperId || !fid) continue;
    if (fieldId && fid !== fieldId) continue;
    const value = payload.value;
    const preview =
      typeof value === "string" || typeof value === "number"
        ? String(value)
        : Array.isArray(value)
          ? value.map(String).join("; ")
          : proposal.content;
    out.push({ proposalId: proposal.id, paperId, fieldId: fid, preview });
  }
  return out;
}

export function pendingKey(paperId: string, fieldId: string): string {
  return `${paperId}::${fieldId}`;
}

export function buildProposeFillPrompt(input: {
  listId: string;
  fieldId: string;
  fieldName: string;
  papers: readonly { id: string; title: string }[];
}): string {
  const lines = [
    `Fill extraction column «${input.fieldName}» (${input.fieldId}) for reading list ${input.listId}.`,
    "",
    "For each paper below:",
    "1. Call get_source_excerpt on an approved paper/note/annotation source.",
    "2. Extract the value for this column from the source.",
    "3. Call propose_paper_field_value with paperId, fieldId, value, fieldName, sourceId, and quoteExact (required). Optionally quotePrefix, quoteSuffix, page.",
    "Do not write cells directly — every value must land as a pending proposal for /ai-review.",
    "",
    "Papers:",
    ...input.papers.map((p) => `- ${p.id} — ${p.title}`),
  ];
  return lines.join("\n");
}

/** Papers whose cell for this field is empty and not already pending review. */
export function emptyCellPaperIds(
  rows: readonly ExtractionRow[],
  fieldId: string,
  pendingKeys?: ReadonlySet<string>,
): string[] {
  return rows
    .filter((row) => {
      if (pendingKeys?.has(pendingKey(row.paper.id, fieldId))) return false;
      const value = row.values.get(fieldId);
      if (value == null) return true;
      if (typeof value === "string") return value.trim() === "";
      if (Array.isArray(value)) return value.length === 0;
      return false;
    })
    .map((row) => row.paper.id);
}

function valueMapForPaper(
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

function formatCell(value: PaperFieldValueData | undefined): string {
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

function columnLabel(column: ExtractionColumnId, defs: readonly PaperFieldDef[]): string {
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
