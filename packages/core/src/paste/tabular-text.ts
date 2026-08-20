/**
 * Turning a spreadsheet paste into a Markdown table.
 *
 * Copying a results table out of Excel, Numbers, Google Sheets or an HTML table
 * puts tab-separated rows on the clipboard. Pasted into Markdown they render as
 * one run-together line, so the reader has to rebuild by hand a table they
 * already had — which for a research note holding measurements is most of the
 * reason the table was copied.
 *
 * Tabs only, never commas. A tab-separated block of several lines is
 * unambiguous: prose does not contain tabs. Comma-separated text is not — half
 * the sentences in a note would qualify — and a rule that turns a paragraph
 * into a table is worse than no rule.
 */

export interface TabularParse {
  /** Header cells, taken from the first row. */
  header: string[];
  /** Every row after the first. */
  rows: string[][];
}

/** Rows fewer than this are a line with a tab in it, not a table. */
const MIN_ROWS = 2;
/** One column is a list, not a table. */
const MIN_COLUMNS = 2;
/**
 * Above this a paste is a data dump rather than a table somebody will read in a
 * note, and rendering it as Markdown makes an unreadable wall either way.
 */
const MAX_ROWS = 500;
const MAX_COLUMNS = 50;

/**
 * Reads a tab-separated block, or returns null when it is not one.
 *
 * Every row must have the same number of cells. A spreadsheet always pads its
 * rectangle, so a ragged block came from somewhere else — a log, a code sample,
 * indented prose — and is left alone.
 */
export function parseTabSeparated(text: string): TabularParse | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  // A trailing newline is how most applications end the copy.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length < MIN_ROWS || lines.length > MAX_ROWS) return null;

  const grid = lines.map((line) => line.split("\t"));
  const columns = grid[0]!.length;
  if (columns < MIN_COLUMNS || columns > MAX_COLUMNS) return null;
  if (grid.some((row) => row.length !== columns)) return null;

  // Every cell of a real table is one line by construction; a cell holding a
  // newline would mean the split lost the row structure.
  const cells = grid.map((row) => row.map((cell) => cell.trim()));
  // A block of blank cells is whitespace someone copied, not data.
  if (cells.every((row) => row.every((cell) => cell === ""))) return null;

  return { header: cells[0]!, rows: cells.slice(1) };
}

/** A cell that Markdown will read as one cell. */
function escapeCell(cell: string): string {
  // A pipe would start a new column, and a backslash before it would escape the
  // escape. Empty cells get a space so the row keeps its shape.
  const escaped = cell.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
  return escaped === "" ? " " : escaped;
}

/** True when every value in the column is a number, so the column reads right-aligned. */
function isNumericColumn(rows: readonly string[][], index: number): boolean {
  const values = rows.map((row) => row[index] ?? "").filter((value) => value !== "");
  if (values.length === 0) return false;
  return values.every((value) =>
    // Thousands separators, a leading sign, a percent or currency suffix: still
    // a number to a reader deciding how to line the column up.
    /^[-+]?[$£€]?\d{1,3}(?:[ ,]\d{3})*(?:\.\d+)?%?$|^[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?%?$/.test(value),
  );
}

export interface TabularResult {
  text: string;
  changed: boolean;
}

/**
 * Renders a parsed block as a Markdown table.
 *
 * Columns are not padded to a common width. Aligned source looks better in a
 * plain editor and worse everywhere else: one edit to a cell and the whole
 * table has to be re-laid, which is work the writer did not ask for, and the
 * rendered output is identical either way.
 */
export function renderMarkdownTable(parse: TabularParse): string {
  const numeric = parse.header.map((_, index) => isNumericColumn(parse.rows, index));
  const separator = numeric.map((right) => (right ? "---:" : "---"));

  const line = (cells: readonly string[]): string => `| ${cells.join(" | ")} |`;

  return [
    line(parse.header.map(escapeCell)),
    line(separator),
    ...parse.rows.map((row) => line(row.map(escapeCell))),
  ].join("\n");
}

/** Converts a tab-separated paste to a Markdown table, or returns it unchanged. */
export function tabSeparatedToMarkdownTable(text: string): TabularResult {
  const parse = parseTabSeparated(text);
  if (!parse) return { text, changed: false };
  const rendered = renderMarkdownTable(parse);
  return { text: rendered, changed: rendered !== text };
}
