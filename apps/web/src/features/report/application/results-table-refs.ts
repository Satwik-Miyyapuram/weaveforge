/**
 * Live results tables in report notes:
 *
 *   ![caption](exptable:<experimentId>,<experimentId>,…)
 *
 * The note stores only the run ids. The table is rebuilt from the runs' current
 * metrics on every render and export, so it never goes stale.
 */
import type { Experiment } from "@weaveforge/core";
import type { ResultsTable } from "@weaveforge/wasm";
import { readyCore } from "@/lib/rust-core";
import { safeArtifactCaption } from "./resolve-artifact-markdown";

const PREFIX = "exptable:";
const REF_RE = new RegExp(`!\\[([^\\]]*)\\]\\(${PREFIX}([^)\\s]*)\\)`, "g");

export interface ResultsTableRef {
  experimentIds: string[];
  caption: string;
  start: number;
  end: number;
  raw: string;
}

export function serialiseResultsTableRef(experimentIds: readonly string[], caption = "Results"): string {
  // encodeURIComponent leaves `()` alone, and `)` would end the Markdown destination.
  const ids = experimentIds
    .map((id) => encodeURIComponent(id).replace(/[()]/g, (c) => (c === "(" ? "%28" : "%29")))
    .join(",");
  return `![${caption.replace(/[\[\]\r\n]/g, "").trim()}](${PREFIX}${ids})`;
}

function decode(part: string): string | null {
  try {
    return decodeURIComponent(part).trim() || null;
  } catch {
    return null;
  }
}

export function parseResultsTableRefs(markdown: string): ResultsTableRef[] {
  const out: ResultsTableRef[] = [];
  for (const m of markdown.matchAll(REF_RE)) {
    const experimentIds = m[2]!.split(",").map(decode).filter((id): id is string => id != null);
    if (experimentIds.length === 0) continue;
    out.push({ experimentIds, caption: m[1]!, start: m.index, end: m.index + m[0].length, raw: m[0] });
  }
  return out;
}

/** A GFM table under a bold caption. */
export function resultsTableMarkdown(table: ResultsTable, caption: string): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
  const row = (cells: readonly string[]) => `| ${cells.map(cell).join(" | ")} |`;
  return [
    `**${safeArtifactCaption(caption)}**`,
    "",
    row(table.header),
    row(table.header.map(() => "---")),
    ...table.rows.map(row),
  ].join("\n");
}

/**
 * A `figure` block holding a `tabular`. The Markdown-to-LaTeX converter passes
 * figure blocks through untouched, so the cells are escaped here.
 */
export function resultsTableLatex(table: ResultsTable, caption: string): string {
  const esc = (s: string) => readyCore().escapeLatexText(s.replace(/[\r\n]+/g, " ")).replace(/\|/g, "\\textbar{}");
  const row = (cells: readonly string[]) => `${cells.map(esc).join(" & ")} \\\\`;
  return [
    "\\begin{figure}[ht]",
    "\\centering",
    `\\begin{tabular}{l${"r".repeat(table.header.length - 1)}}`,
    "\\hline",
    row(table.header),
    "\\hline",
    ...table.rows.map(row),
    "\\hline",
    "\\end{tabular}",
    `\\caption{${esc(caption)}}`,
    "\\end{figure}",
  ].join("\n");
}

function notFound(caption: string, count: number): string {
  return `> ⚠️ Results table “${safeArtifactCaption(caption)}”: ${count} run${count === 1 ? "" : "s"} not found.`;
}

/** Replace every results-table ref with its table, on lines of its own. */
export function resolveResultsTables(
  body: string,
  experiments: readonly Experiment[],
  format: "markdown" | "latex",
): string {
  const refs = parseResultsTableRefs(body);
  if (refs.length === 0) return body;
  const byId = new Map(experiments.map((e) => [e.id, e]));
  let out = "";
  let cursor = 0;
  for (const ref of refs) {
    out += body.slice(cursor, ref.start);
    cursor = ref.end;
    const runs = ref.experimentIds.map((id) => byId.get(id)).filter((e): e is Experiment => e != null);
    const missing = ref.experimentIds.length - runs.length;
    const caption = ref.caption || "Results";
    const parts: string[] = [];
    if (runs.length > 0) {
      const table = readyCore().resultsTable(runs);
      parts.push(format === "latex" ? resultsTableLatex(table, caption) : resultsTableMarkdown(table, caption));
    }
    if (missing > 0) parts.push(notFound(caption, missing));
    // Tables and figure blocks only parse at the start of a line.
    const lead = out === "" || out.endsWith("\n\n") ? "" : "\n\n";
    const next = body.slice(cursor);
    const trail = next === "" || next.startsWith("\n\n") ? "" : "\n\n";
    out += lead + parts.join("\n\n") + trail;
  }
  return out + body.slice(cursor);
}
