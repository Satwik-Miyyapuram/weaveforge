import type { BlobRef, Row, ServerSource } from "../domain/ports";
import { FILE_ONLY_KINDS, SOFT_DELETE_TABLES, TABLE_BY_KIND, toCamelRow } from "./postgrest-source";

/**
 * One page of an exporter kind from the old local database: the desktop bridge's `migrate097Read`.
 * `after` is the last row's key values (null for the first page); the shell caps `limit` at 1000.
 */
export type ReadPage = (kind: string, after: readonly unknown[] | null, limit: number) => Promise<Row[]>;

/**
 * Paging key per kind, in key-column order. Mirrors ALLOWLIST in apps/shell/src/local_pg/read.rs, which
 * the shell enforces: a kind missing here cannot be read. Keep the two lists in step.
 */
const KEY_BY_KIND: Readonly<Record<string, readonly string[]>> = {
  notes: ["id"],
  papers: ["id"],
  tags: ["id"],
  paperFields: ["id"],
  paperFieldValues: ["id"],
  relations: ["id"],
  readingLists: ["id"],
  screening: ["id"],
  logEntries: ["id"],
  milestones: ["id"],
  experiments: ["id"],
  metrics: ["experiment_id", "metric", "step"],
  reportSections: ["id"],
  annotations: ["id"],
  annotationPins: ["id"],
  libraryPins: ["id"],
  comments: ["id"],
  settings: ["user_id"],
  aiProposals: ["id"],
  blobs: ["id"],
};

/** The shell's own cap on one page; asking for more is clamped there, so this is the page size. */
const PAGE_LIMIT = 1000;

const NOT_WIRED = "not wired";

/** A row is trashed when the local deleted_at column is set (the same column PostgREST filters on). */
function isTrashed(row: Row): boolean {
  return row.deleted_at !== null && row.deleted_at !== undefined;
}

export interface LocalPgSourceOptions {
  read: ReadPage;
  /** Rows per bridge call. Defaults to the shell's cap; tests use a small one. */
  pageSize?: number;
  /** Unflushed local writes. Not part of the old local database, so the caller supplies it or the export refuses. */
  pendingOutbox?: () => Promise<number>;
  undecryptable?: (kind: string) => Promise<number>;
  secretProviders?: () => Promise<string[]>;
  fetchBlob?: (ref: BlobRef) => Promise<Uint8Array>;
  markExported097?: () => Promise<void>;
}

/**
 * The old local database as the export's server side. Reads go through the desktop bridge, one read-only
 * page at a time, so the shell refuses any write. Rows match PostgrestSource: live rows only for soft-delete
 * tables, trash listed separately, ink empty, top-level keys camel-cased.
 */
export class LocalPgSource implements ServerSource {
  private readonly opts: LocalPgSourceOptions;

  constructor(opts: LocalPgSourceOptions) {
    this.opts = opts;
  }

  /** Reads every page of `kind` in key order. A refused read rejects the whole listing. */
  private async readAll(kind: string): Promise<Row[]> {
    const key = KEY_BY_KIND[kind];
    if (!key) throw new Error(`unknown kind: ${kind}`);
    const limit = this.opts.pageSize ?? PAGE_LIMIT;
    const out: Row[] = [];
    let after: readonly unknown[] | null = null;
    for (;;) {
      const page: Row[] = await this.opts.read(kind, after, limit);
      if (page.length === 0) return out;
      out.push(...page);
      const last = page[page.length - 1] as Row;
      after = key.map((column) => last[column]);
    }
  }

  private tableOf(kind: string): string {
    const table = (TABLE_BY_KIND as Record<string, string>)[kind];
    if (!table) throw new Error(`unknown kind: ${kind}`);
    return table;
  }

  async listRows(kind: string): Promise<Row[]> {
    if (FILE_ONLY_KINDS.includes(kind)) return [];
    const rows = await this.readAll(kind);
    const live = SOFT_DELETE_TABLES.has(this.tableOf(kind)) ? rows.filter((row) => !isTrashed(row)) : rows;
    return live.map(toCamelRow);
  }

  /** Trashed rows (deleted_at set), camel-cased. Tables without deleted_at have no trash. */
  async listTrashed(kind: string): Promise<Row[]> {
    if (FILE_ONLY_KINDS.includes(kind)) return [];
    if (!SOFT_DELETE_TABLES.has(this.tableOf(kind))) return [];
    const trashed = (await this.readAll(kind)).filter(isTrashed);
    return trashed.map(toCamelRow);
  }

  /** The live row count. One read is one snapshot, so it agrees with listRows by construction. */
  async countRows(kind: string): Promise<number> {
    if (FILE_ONLY_KINDS.includes(kind)) return 0;
    return (await this.listRows(kind)).length;
  }

  async secretProviders(): Promise<string[]> {
    if (!this.opts.secretProviders) throw new Error(`secretProviders ${NOT_WIRED}`);
    return this.opts.secretProviders();
  }

  async pendingOutbox(): Promise<number> {
    if (!this.opts.pendingOutbox) throw new Error(`pendingOutbox ${NOT_WIRED}`);
    return this.opts.pendingOutbox();
  }

  async undecryptable(kind: string): Promise<number> {
    if (!this.opts.undecryptable) throw new Error(`undecryptable ${NOT_WIRED}`);
    return this.opts.undecryptable(kind);
  }

  async listBlobs(): Promise<BlobRef[]> {
    const rows = await this.readAll("blobs");
    return rows.map((r) => ({ bucket: String(r.bucket), path: String(r.path), sizeBytes: Number(r.size_bytes) }));
  }

  async fetchBlob(ref: BlobRef): Promise<Uint8Array> {
    if (!this.opts.fetchBlob) throw new Error(`fetchBlob ${NOT_WIRED}`);
    return this.opts.fetchBlob(ref);
  }

  async markExported097(): Promise<void> {
    if (!this.opts.markExported097) throw new Error(`markExported097 ${NOT_WIRED}`);
    return this.opts.markExported097();
  }
}
