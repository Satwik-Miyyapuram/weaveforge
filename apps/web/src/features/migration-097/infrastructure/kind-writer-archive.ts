import { ConflictError } from "@weaveforge/core";
import type { KindWriter } from "../domain/kind-writer";
import type { ArchivedOnly } from "../domain/report";
import type { FileSink, Row } from "../domain/ports";
import { SETTINGS_SECRET_COLUMNS } from "../domain/server-only-fields";

/** Where a kind's rows are archived, one array entry per server row. */
export function archivePath(kind: string): string {
  return `.weaveforge/migration-0.9.7/archive/${kind}.json`;
}

/** A kind's app files: `readBack` returns every row those files hold. */
export type AppFormat = {
  write(kind: string, row: Row): Promise<void>;
  readBack(kind: string): Promise<Row[]>;
};

/** What names a row in its app file, for kinds whose file does not keep the server id. */
const KEY_COLUMNS: Record<string, readonly string[]> = {
  libraryPins: ["resourceType", "resourceId"],
  relations: ["fromPaper", "toPaper", "relation"],
  paperFieldValues: ["fieldId", "paperId"],
  metrics: ["experimentId"],
  quotationTypes: ["paperId", "annotationKey"],
  annotationPins: ["paperId", "annotationKey"],
  citationAlerts: ["paperId"],
  settings: [],
};

function keyOf(kind: string, row: Row): string {
  if (kind === "readingListItems") return `${row.listId}\n${row.paperId ?? row.vaultPageId}`;
  return (KEY_COLUMNS[kind] ?? ["id"]).map((c) => String(row[c])).join("\n");
}

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
 * Writer for kinds kept in app files through `format`, with a backup of every row in archivePath(kind).
 * readBack answers from the app files; only a row whose app write failed (an orphan, a name clash) is
 * answered from the backup. Such a row is listed in archivedOnly and never blocks the run.
 * Without `format` the backup is the only copy.
 */
export function createArchiveWriter(
  sink: FileSink,
  kinds: readonly string[],
  format?: AppFormat,
  onFormatError?: (kind: string, row: Row, err: unknown) => void,
): KindWriter {
  const rows = new Map<string, Row[]>();
  const failed: ArchivedOnly[] = [];
  const failedRows = new Set<Row>();
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
        await format?.write(kind, { ...kept });
      } catch (err) {
        // Fixed codes only: error text can carry paths or secret-like text, so it never reaches report.json.
        failedRows.add(kept);
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
      const archived = JSON.parse(await sink.readText(path)) as Row[];
      if (!format) return archived;
      const all = rows.get(kind) ?? [];
      const written = new Set(all.filter((row) => !failedRows.has(row)).map((row) => keyOf(kind, row)));
      const inApp = (await format.readBack(kind)).filter((row) => written.has(keyOf(kind, row)));
      return [...inApp, ...archived.filter((_, i) => failedRows.has(all[i]!))];
    },
  };
}
