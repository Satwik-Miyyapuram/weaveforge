import type { BlobRef, Row, ServerSource } from "../domain/ports";
import { PAGE_SIZE, listAllPages } from "./paging";

/** camelCase kind -> snake_case PostgREST table. */
export const TABLE_BY_KIND = {
  notes: "vault_pages",
  papers: "papers",
  tags: "tags",
  paperFields: "paper_field_defs",
  paperFieldValues: "paper_field_values",
  relations: "paper_relations",
  readingLists: "reading_lists",
  screening: "screening_decisions",
  logEntries: "log_entries",
  milestones: "milestones",
  experiments: "experiments",
  metrics: "experiment_metrics",
  reportSections: "report_sections",
  annotations: "reader_annotations",
  annotationPins: "annotation_pins",
  libraryPins: "library_pins",
  comments: "comments",
  settings: "user_settings",
  aiProposals: "ai_proposals",
  blobs: "blob_objects",
} as const;

/** Kinds with no server table: their rows are files only, so the server side lists none. */
const FILE_ONLY_KINDS: readonly string[] = ["ink"];

/**
 * Tables that carry a deleted_at column (the sync-registered tables, from db/migrations 0118/0120/0138).
 * Any other table has no such column, and PostgREST answers 400 to a filter on it.
 */
const SOFT_DELETE_TABLES: ReadonlySet<string> = new Set([
  "papers", "tags", "paper_field_defs", "paper_field_values", "paper_relations", "reading_lists",
  "reading_list_items", "log_entries", "milestones", "experiments", "report_sections",
  "reader_annotations", "annotation_pins", "library_pins", "vault_pages", "screening_decisions", "paper_tags",
]);

export interface PostgrestSourceOptions {
  baseUrl: string;
  userId: string;
  fetch: typeof fetch;
  /** Sent on every request (auth and key headers come from the caller). */
  headers: Record<string, string>;
  /** Real outbox check is wired by the integrator. */
  pendingOutbox?: () => Promise<number>;
  /** Real decrypt check is wired by the integrator. */
  undecryptable?: (kind: string) => Promise<number>;
  /** Resolves a short-lived download URL for a blob (the web app's signed-urls route). */
  signedUrl?: (bucket: string, path: string) => Promise<string | null>;
}

const NOT_WIRED = "not wired";
const SIGNED_URL_NOT_WIRED = "signedUrl not wired";

/** Shallow snake_case -> camelCase on top-level keys; nested values untouched. */
export function toCamelRow(row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = value;
  }
  return out;
}

function tableFor(kind: string): string {
  const table = (TABLE_BY_KIND as Record<string, string>)[kind];
  if (!table) throw new Error(`unknown kind: ${kind}`);
  return table;
}

export class PostgrestSource implements ServerSource {
  private readonly opts: PostgrestSourceOptions;

  constructor(opts: PostgrestSourceOptions) {
    this.opts = opts;
  }

  private filter(table: string, trashed = false): string {
    const base = `${this.opts.baseUrl}/${table}?user_id=eq.${this.opts.userId}`;
    if (!SOFT_DELETE_TABLES.has(table)) return base;
    return `${base}&deleted_at=${trashed ? "not.is.null" : "is.null"}`;
  }

  /** The read path: the export only lists, so any other method is refused before a request. */
  private async request(
    url: string,
    init: { method: string; body?: string; extra?: Record<string, string> },
    table: string,
  ): Promise<Response> {
    if (init.method !== "GET" && init.method !== "HEAD") {
      throw new Error(`read-only export source refused ${init.method} ${table}`);
    }
    return this.send(url, init, table);
  }

  /** Sends one request. Only markExported097 uses it directly, for its single allowlisted rpc. */
  private async send(
    url: string,
    init: { method: string; body?: string; extra?: Record<string, string> },
    table: string,
  ): Promise<Response> {
    const res = await this.opts.fetch(url, {
      method: init.method,
      headers: { ...this.opts.headers, ...init.extra },
      body: init.body,
    });
    if (!res.ok) throw new Error(`${init.method} ${table} failed: HTTP ${res.status}`);
    return res;
  }

  async listRows(kind: string): Promise<Row[]> {
    if (FILE_ONLY_KINDS.includes(kind)) return [];
    const table = tableFor(kind);
    const rows = await listAllPages<Row>(async (offset, limit) => {
      const url = `${this.filter(table)}&order=id.asc&limit=${limit}&offset=${offset}`;
      const res = await this.request(url, { method: "GET" }, table);
      return (await res.json()) as Row[];
    }, PAGE_SIZE);
    return rows.map(toCamelRow);
  }

  /** Raw trashed rows (deleted_at not null). Tables without deleted_at have no trash. */
  async listTrashed(kind: string): Promise<Row[]> {
    if (FILE_ONLY_KINDS.includes(kind)) return [];
    const table = tableFor(kind);
    if (!SOFT_DELETE_TABLES.has(table)) return [];
    return listAllPages<Row>(async (offset, limit) => {
      const url = `${this.filter(table, true)}&order=id.asc&limit=${limit}&offset=${offset}`;
      const res = await this.request(url, { method: "GET" }, table);
      return (await res.json()) as Row[];
    }, PAGE_SIZE);
  }

  async countRows(kind: string): Promise<number> {
    if (FILE_ONLY_KINDS.includes(kind)) return 0;
    const table = tableFor(kind);
    const res = await this.request(
      this.filter(table),
      { method: "HEAD", extra: { Prefer: "count=exact" } },
      table,
    );
    const range = res.headers.get("content-range") ?? "";
    const total = Number(range.split("/")[1]);
    if (range.split("/").length < 2 || !Number.isInteger(total)) {
      throw new Error(`count ${table} failed: no total in content-range`);
    }
    return total;
  }

  async pendingOutbox(): Promise<number> {
    if (!this.opts.pendingOutbox) throw new Error(`pendingOutbox ${NOT_WIRED}`);
    return this.opts.pendingOutbox();
  }

  async undecryptable(kind: string): Promise<number> {
    if (!this.opts.undecryptable) throw new Error(`undecryptable ${NOT_WIRED}`);
    return this.opts.undecryptable(kind);
  }

  /** The owner's blob_objects rows. blob_objects has no sha256 column, so only size_bytes comes back. */
  async listBlobs(): Promise<BlobRef[]> {
    const table = "blob_objects";
    const rows = await listAllPages<Row>(async (offset, limit) => {
      const url =
        `${this.opts.baseUrl}/${table}?user_id=eq.${this.opts.userId}` +
        `&select=bucket,path,size_bytes&order=bucket.asc,path.asc&limit=${limit}&offset=${offset}`;
      const res = await this.request(url, { method: "GET" }, table);
      return (await res.json()) as Row[];
    });
    return rows.map((r) => ({ bucket: String(r.bucket), path: String(r.path), sizeBytes: Number(r.size_bytes) }));
  }

  /** Downloads through a signed URL. The caller checks the length and computes the sha256 locally. */
  async fetchBlob(ref: BlobRef): Promise<Uint8Array> {
    if (!this.opts.signedUrl) throw new Error(SIGNED_URL_NOT_WIRED);
    const url = await this.opts.signedUrl(ref.bucket, ref.path);
    if (!url) throw new Error(`no signed url for ${ref.bucket}/${ref.path}`);
    const res = await this.opts.fetch(url);
    if (!res.ok) throw new Error(`blob download failed: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  /** The server function (0164) takes no args and sets the marker for auth.uid(); body is {}. */
  async markExported097(): Promise<void> {
    await this.send(
      `${this.opts.baseUrl}/rpc/mark_exported_097`,
      { method: "POST", body: "{}", extra: { "content-type": "application/json" } },
      "rpc/mark_exported_097",
    );
  }
}
