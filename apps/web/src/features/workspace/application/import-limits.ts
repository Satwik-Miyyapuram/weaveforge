import { loadCore, readyCore } from "@/lib/rust-core";

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

type ImportLimits = { readonly [K in keyof typeof IMPORT_LIMITS]: number };

/** Rust reports a cap as a plain error; the callers match `ImportLimitError`. */
function asImportLimitError(error: unknown): unknown {
  return error instanceof Error ? new ImportLimitError(error.message) : error;
}

/** What the archive's directory says about one entry, before it is inflated. */
export interface ArchiveEntryInfo {
  name: string;
  originalSize: number;
}

/**
 * A `filter` for `unzipSync` that checks the archive's own directory first.
 *
 * Too many entries, or a declared total past the cap, throws before anything
 * is inflated. An entry declared over the file cap is skipped and named in
 * `oversize`. A declared size can lie, so `sanitizeArchiveEntries` still checks
 * the real bytes afterwards. The counting is Rust's (`ArchiveBudget`).
 */
export function archiveBudget(limits: ImportLimits = IMPORT_LIMITS): {
  filter: (info: ArchiveEntryInfo) => boolean;
  readonly oversize: string[];
} {
  const core = readyCore();
  const budget = core.createArchiveBudget(limits);
  return {
    filter: (info) => {
      try {
        return budget.admit(info.name, info.originalSize);
      } catch (error) {
        throw asImportLimitError(error);
      }
    },
    get oversize() {
      return budget.oversize;
    },
  };
}

/** Inflate only the entries `archiveBudget` lets through. */
export async function unzipWithinLimits(
  bytes: Uint8Array,
  limits: ImportLimits = IMPORT_LIMITS,
): Promise<{ entries: Record<string, Uint8Array>; oversize: string[] }> {
  // `archiveBudget` runs Rust, so the core has to be loaded first.
  await loadCore();
  const { unzipSync } = await import("fflate");
  const budget = archiveBudget(limits);
  const entries = unzipSync(bytes, { filter: budget.filter });
  return { entries, oversize: budget.oversize };
}

export interface ArchiveEntry {
  path: string;
  bytes: Uint8Array;
}

/** A file an import left out, and why, so the preview can say so. */
export interface SkippedFile {
  path: string;
  reason: string;
}

export const SKIP_UNSAFE_NAME = "its name could reach outside the folder";
export const SKIP_TOO_BIG = `it is over the ${Math.round(IMPORT_LIMITS.maxFileBytes / 1024 / 1024)} MB file limit`;

/**
 * Drop unsafe entries and stop if the archive exceeds its budget.
 *
 * Traversal attempts are skipped rather than fatal, so one bad name in an
 * otherwise good archive does not cost the user the whole import. The size and
 * count caps throw, because past them nothing can be trusted to finish. The
 * decision is Rust's (`planArchiveEntries`); this only maps it back onto bytes.
 * Needs the core loaded, which `unzipWithinLimits` ensures.
 */
export function sanitizeArchiveEntries(entries: Record<string, Uint8Array>): {
  safe: ArchiveEntry[];
  skipped: SkippedFile[];
} {
  const names = Object.keys(entries);
  let plan;
  try {
    plan = readyCore().planArchiveEntries(
      names.map((name) => ({ name, size: entries[name]!.byteLength })),
      IMPORT_LIMITS,
    );
  } catch (error) {
    throw asImportLimitError(error);
  }

  const safe: ArchiveEntry[] = [];
  const skipped: SkippedFile[] = [];
  for (const { name, action } of plan) {
    if (action === "keep") safe.push({ path: name, bytes: entries[name]! });
    else if (action === "unsafe-name") skipped.push({ path: name, reason: SKIP_UNSAFE_NAME });
    else if (action === "too-big") skipped.push({ path: name, reason: SKIP_TOO_BIG });
  }
  return { safe, skipped };
}

/**
 * Strip the single wrapping directory an export ZIP carries, so
 * `weaveforge-2026-08-05/notes/x.md` imports as `notes/x.md`. The rule is Rust's
 * (`stripArchiveRoot`).
 */
export function stripArchiveRoot(entries: readonly ArchiveEntry[]): ArchiveEntry[] {
  const paths = readyCore().stripArchiveRoot(entries.map((entry) => entry.path));
  return entries.map((entry, index) => ({ ...entry, path: paths[index]! }));
}
