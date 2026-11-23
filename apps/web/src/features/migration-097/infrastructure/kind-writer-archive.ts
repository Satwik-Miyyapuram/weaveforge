import type { KindWriter } from "../domain/kind-writer";
import type { FileSink, Row } from "../domain/ports";
import { SETTINGS_SECRET_COLUMNS } from "../domain/server-only-fields";
import { isSecretValueKey } from "@/backend/providers/files/file-settings-section";

/** Where a kind's rows are archived, one array entry per server row. */
export function archivePath(kind: string): string {
  return `.weaveforge/migration-0.9.7/archive/${kind}.json`;
}

/** Writes a row to its files-first home. Best effort: the archive, not this, is what verify reads back. */
export type FormatWrite = (kind: string, row: Row) => Promise<void>;

/** The plain scalar fields of the legacy integrations bag (e.g. a Zotero collection); every secret-named key is dropped. */
function plainIntegrations(bag: unknown): Record<string, Record<string, unknown>> | undefined {
  if (bag === null || typeof bag !== "object" || Array.isArray(bag)) return undefined;
  const out: Record<string, Record<string, unknown>> = {};
  for (const [provider, fields] of Object.entries(bag)) {
    if (fields === null || typeof fields !== "object" || Array.isArray(fields)) continue;
    for (const [name, value] of Object.entries(fields)) {
      if (isSecretValueKey(name) || (value !== null && typeof value === "object")) continue;
      (out[provider] ??= {})[name] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Columns that never reach disk: settings secrets stay on the server (they are sealed separately). */
function stripped(kind: string, row: Row): Row {
  if (kind !== "settings") return { ...row };
  const skip = new Set<string>(SETTINGS_SECRET_COLUMNS);
  const out: Row = Object.fromEntries(Object.entries(row).filter(([k]) => !skip.has(k)));
  const plain = plainIntegrations(row.integrations);
  if (plain) out.integrations = plain;
  return out;
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
        onFormatError?.(kind, row, err);
      }
    },
    async readBack(kind) {
      check(kind);
      const path = archivePath(kind);
      await sink.write(path, `${JSON.stringify(rows.get(kind) ?? [], null, 2)}\n`);
      return JSON.parse(await sink.readText(path)) as Row[];
    },
  };
}
