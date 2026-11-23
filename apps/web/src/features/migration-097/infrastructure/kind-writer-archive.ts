import { ConflictError } from "@weaveforge/core";
import type { KindWriter } from "../domain/kind-writer";
import type { ArchivedOnly } from "../domain/report";
import type { FileSink, Row } from "../domain/ports";
import { SETTINGS_SECRET_COLUMNS } from "../domain/server-only-fields";

/** Where a kind's rows are archived, one array entry per server row. */
export function archivePath(kind: string): string {
  return `.weaveforge/migration-0.9.7/archive/${kind}.json`;
}

/** Writes a row to its files-first home. Best effort: the archive, not this, is what verify reads back. */
export type FormatWrite = (kind: string, row: Row) => Promise<void>;

/**
 * Columns that never reach disk: settings secrets stay on the server (they are sealed separately). The whole
 * integrations bag is one of them, whatever its keys; settingsSecretNames names its providers for reconnect.
 */
function stripped(kind: string, row: Row): Row {
  if (kind !== "settings") return { ...row };
  const skip = new Set<string>(SETTINGS_SECRET_COLUMNS);
  return Object.fromEntries(Object.entries(row).filter(([k]) => !skip.has(k)));
}

/** A row's id for the report: `id`, else its *Id key columns joined in name order (pins), else a fixed marker. */
export function rowLabel(row: Row): string {
  if (row.id !== null && row.id !== undefined && row.id !== "") return String(row.id);
  const keys = Object.keys(row)
    .filter((k) => /Id$/.test(k) && row[k] !== null && row[k] !== undefined && row[k] !== "")
    .sort();
  return keys.length > 0 ? keys.map((k) => String(row[k])).join(":") : "(no id)";
}

/**
 * Lossless writer for kinds with no file home, or only a partial one. Every row is kept, in server order, and
 * readBack writes them to archivePath(kind) and reads that file back, so verify counts and compares every row.
 * `format` also writes each row to its files-first home; its failure (an orphan, a name clash) is passed to
 * `onFormatError` and never blocks the run, because the archive already holds the row.
 */
export function createArchiveWriter(
  sink: FileSink,
  kinds: readonly string[],
  format?: FormatWrite,
  onFormatError?: (kind: string, row: Row, err: unknown) => void,
): KindWriter {
  const rows = new Map<string, Row[]>();
  const failed: ArchivedOnly[] = [];
  const check = (kind: string): void => {
    if (!kinds.includes(kind)) throw new Error(`kind-writer-archive: unknown kind "${kind}"`);
  };
  return {
    kinds,
    async write(kind, row) {
      check(kind);
      const kept = stripped(kind, row);
      (rows.get(kind) ?? rows.set(kind, []).get(kind)!).push(kept);
      try {
        // The stripped copy, so a format handler can never put a settings secret on disk.
        await format?.(kind, { ...kept });
      } catch (err) {
        // Fixed codes only: error text can carry paths or secret-like text, so it never reaches report.json.
        failed.push({ kind, id: rowLabel(row), reason: err instanceof ConflictError ? "conflict" : "write failed" });
        // The stripped copy here too, so a logging handler never sees a settings secret.
        onFormatError?.(kind, { ...kept }, err);
      }
    },
    archivedOnly: () => [...failed],
    async readBack(kind) {
      check(kind);
      const path = archivePath(kind);
      await sink.write(path, `${JSON.stringify(rows.get(kind) ?? [], null, 2)}\n`);
      return JSON.parse(await sink.readText(path)) as Row[];
    },
  };
}
