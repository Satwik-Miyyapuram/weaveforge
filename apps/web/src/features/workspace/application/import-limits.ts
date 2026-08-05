import { isSafeWorkspacePath } from "@thesis/core";

/**
 * Bounds on an imported archive.
 *
 * The folder is untrusted: it may have been shared by a collaborator or written
 * by something else on disk. `unzipSync` will happily inflate a 40 KB file into
 * gigabytes and will happily hand back an entry called `../../etc/passwd`, so
 * both are checked before anything is read.
 *
 * The same shape of caps the Overleaf reader already applies to a cloned repo.
 */
export const IMPORT_LIMITS = {
  /** Total uncompressed bytes across every entry. */
  maxTotalBytes: 256 * 1024 * 1024,
  /** One file. A single markdown note far past this is not a note. */
  maxFileBytes: 32 * 1024 * 1024,
  maxEntries: 20_000,
} as const;

export class ImportLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportLimitError";
  }
}

export interface ArchiveEntry {
  path: string;
  bytes: Uint8Array;
}

/**
 * Drop unsafe entries and stop if the archive exceeds its budget.
 *
 * Traversal attempts are skipped rather than fatal — one bad name in an
 * otherwise good archive should not cost the user the whole import — but the
 * size and count caps throw, because past them nothing can be trusted to
 * finish.
 */
export function sanitizeArchiveEntries(
  entries: Record<string, Uint8Array>,
): { safe: ArchiveEntry[]; skipped: string[] } {
  const names = Object.keys(entries);
  if (names.length > IMPORT_LIMITS.maxEntries) {
    throw new ImportLimitError(
      `Archive has ${names.length} entries, over the ${IMPORT_LIMITS.maxEntries} limit.`,
    );
  }

  const safe: ArchiveEntry[] = [];
  const skipped: string[] = [];
  let total = 0;

  for (const name of names) {
    const bytes = entries[name]!;
    // Directory markers carry no content.
    if (name.endsWith("/") || bytes.byteLength === 0) continue;

    if (!isSafeWorkspacePath(name)) {
      skipped.push(name);
      continue;
    }
    if (bytes.byteLength > IMPORT_LIMITS.maxFileBytes) {
      skipped.push(name);
      continue;
    }

    total += bytes.byteLength;
    if (total > IMPORT_LIMITS.maxTotalBytes) {
      throw new ImportLimitError(
        `Archive expands past ${Math.round(IMPORT_LIMITS.maxTotalBytes / 1024 / 1024)} MB; refusing to continue.`,
      );
    }

    safe.push({ path: name, bytes });
  }

  return { safe, skipped };
}

/**
 * Strip the single wrapping directory an export ZIP carries, so
 * `weaveforge-2026-08-05/notes/x.md` imports as `notes/x.md`.
 */
export function stripArchiveRoot(entries: readonly ArchiveEntry[]): ArchiveEntry[] {
  if (entries.length === 0) return [];
  const roots = new Set(entries.map((entry) => entry.path.split("/")[0]));
  if (roots.size !== 1) return [...entries];
  const root = `${[...roots][0]}/`;
  // Only strip when every entry is inside it and something remains after.
  if (!entries.every((entry) => entry.path.startsWith(root) && entry.path.length > root.length)) {
    return [...entries];
  }
  return entries.map((entry) => ({ ...entry, path: entry.path.slice(root.length) }));
}
