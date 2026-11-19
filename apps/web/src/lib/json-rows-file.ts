import type { IWorkspaceFs } from "@weaveforge/core";
import { ConflictError } from "@weaveforge/core";

/** One object in a JSON rows file. */
export type JsonRow = Record<string, unknown>;

/** How often a change re-reads and re-applies when the file changed under it. */
const WRITE_ATTEMPTS = 5;

/**
 * The rows of a JSON rows file: one JSON array of objects. Empty or blank text is
 * no rows.
 *
 * @throws when the text is not a JSON array of objects; such a file is never written over.
 */
export function parseJsonRows(text: string, path: string): JsonRow[] {
  if (!text.trim()) return [];
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value) || value.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error(`${path} is not a JSON array of objects; not changed.`);
  }
  return value as JsonRow[];
}

/** The file text for `rows`: two-space indented JSON with one trailing newline. */
export function renderJsonRows(rows: readonly JsonRow[]): string {
  return `${JSON.stringify(rows, null, 2)}\n`;
}

/** The file's text (null when it does not exist) and its rows. */
export async function readJsonRows(
  fs: IWorkspaceFs,
  path: string,
): Promise<{ text: string | null; rows: JsonRow[] }> {
  if (!(await fs.stat(path))) return { text: null, rows: [] };
  const text = await fs.readText(path);
  return { text, rows: parseJsonRows(text, path) };
}

/**
 * Applies `edit` to the rows on disk and writes them only if the file is still the
 * text it read (`writeTextIf`); otherwise reads the newer file and applies `edit`
 * again, so a row added outside the app between the read and the write is kept.
 * A missing file that would stay empty is not created. Returns the rows written.
 */
export async function changeJsonRows(
  fs: IWorkspaceFs,
  path: string,
  edit: (rows: JsonRow[]) => JsonRow[],
): Promise<JsonRow[]> {
  if (!fs.writeTextIf) throw new Error(`${path}: this workspace has no conditional write; not saved.`);
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    const { text, rows } = await readJsonRows(fs, path);
    const next = edit(rows);
    if (text === null && next.length === 0) return next;
    if (text === null && path.includes("/")) await fs.mkdirp(path.slice(0, path.lastIndexOf("/")));
    if (await fs.writeTextIf(path, renderJsonRows(next), text)) return next;
  }
  throw new ConflictError(`${path} kept changing on disk; not saved.`);
}
