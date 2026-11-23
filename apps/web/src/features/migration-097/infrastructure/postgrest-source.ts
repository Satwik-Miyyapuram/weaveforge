import type { BlobRef, Row, ServerSource } from "../domain/ports";
import { SECRET_TABLES } from "../domain/secret-tables";
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

/** Tables whose owner is not user_id. A user_id filter on them is a PostgREST 400. */
const OWNER_COLUMN: Readonly<Record<string, string>> = {
  comments: "author_id",
  screening_decisions: "reviewer_id",
};

/**
 * Extra filters that keep a table to the user's personal rows: comments on the five types 0165 archives
 * (the ones 0168 counts) and on milestones, which 0167 archives. Comments on experiments and lab check-ins
 * stay live on the server, so they are not exported.
 */
const ROW_SCOPE: Readonly<Record<string, string>> = {
  comments: "&resource_type=in.(report_section,reading_list,paper,vault_page,log_entry,milestone)",
};

/** The ROW_SCOPE comment resource types and the user's table of each, for comments others wrote on the user's items. */
const COMMENT_ITEM_TABLES: Readonly<Record<string, string>> = {
  report_section: "report_sections",
  reading_list: "reading_lists",
  paper: "papers",
  vault_page: "vault_pages",
  log_entry: "log_entries",
  milestone: "milestones",
};

/** Item ids per comment query, so the URL stays well under proxy limits (50 uuids is about 1.9 KB). */
const IDS_PER_QUERY = 50;

export interface PostgrestSourceOptions {
  baseUrl: string;
  userId: string;
  fetch: typeof fetch;
  /** Sent on every request (auth and key headers come from the caller). */
  headers: Record<string, string>;
  /** Real outbox check is wired by the integrator. */
  pendingOutbox?: () => Promise<number>;
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

/** The total from a Prefer: count=exact response. Throws when the header has no total, so the count reads as unknown. */
function totalOf(res: Response, table: string): number {
  const range = res.headers.get("content-range") ?? "";
  const total = Number(range.split("/")[1]);
  if (range.split("/").length < 2 || !Number.isInteger(total)) {
    throw new Error(`count ${table} failed: no total in content-range`);
  }
  return total;
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
    const owner = OWNER_COLUMN[table] ?? "user_id";
    const base = `${this.opts.baseUrl}/${table}?${owner}=eq.${this.opts.userId}${ROW_SCOPE[table] ?? ""}`;
    if (!SOFT_DELETE_TABLES.has(table)) return base;
    return `${base}&deleted_at=${trashed ? "not.is.null" : "is.null"}`;
  }

  private async request(
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

  /** Every row of `base` (a filtered table URL), paged and in id order. */
  private async listAll(base: string, table: string): Promise<Row[]> {
    return listAllPages<Row>(async (offset, limit) => {
      const res = await this.request(`${base}&order=id.asc&limit=${limit}&offset=${offset}`, { method: "GET" }, table);
      return (await res.json()) as Row[];
    }, PAGE_SIZE);
  }

  /**
   * Comment queries for what others wrote on the user's items (live or trashed): RLS lets the owner read them,
   * and 0165 archives them with the user's own, so they go in the user's sidecars too.
   */
  private async othersCommentQueries(): Promise<string[]> {
    const uid = this.opts.userId;
    const queries: string[] = [];
    for (const [type, table] of Object.entries(COMMENT_ITEM_TABLES)) {
      const ids = (await this.listAll(`${this.opts.baseUrl}/${table}?select=id&user_id=eq.${uid}`, table)).map((r) => String(r.id));
      for (let i = 0; i < ids.length; i += IDS_PER_QUERY) {
        const chunk = ids.slice(i, i + IDS_PER_QUERY).join(",");
        queries.push(`${this.opts.baseUrl}/comments?author_id=neq.${uid}&resource_type=eq.${type}&resource_id=in.(${chunk})`);
      }
    }
    return queries;
  }

  async listRows(kind: string): Promise<Row[]> {
    if (FILE_ONLY_KINDS.includes(kind)) return [];
    const table = tableFor(kind);
    const rows = await this.listAll(this.filter(table), table);
    if (kind === "comments") for (const q of await this.othersCommentQueries()) rows.push(...(await this.listAll(q, table)));
    return rows.map(toCamelRow);
  }

  /** Trashed rows (deleted_at not null), camel-cased like live rows so the codec sees the same shape. Tables without deleted_at have no trash. */
  async listTrashed(kind: string): Promise<Row[]> {
    if (FILE_ONLY_KINDS.includes(kind)) return [];
    const table = tableFor(kind);
    if (!SOFT_DELETE_TABLES.has(table)) return [];
    const rows = await listAllPages<Row>(async (offset, limit) => {
      const url = `${this.filter(table, true)}&order=id.asc&limit=${limit}&offset=${offset}`;
      const res = await this.request(url, { method: "GET" }, table);
      return (await res.json()) as Row[];
    }, PAGE_SIZE);
    return rows.map(toCamelRow);
  }

  async countRows(kind: string): Promise<number> {
    if (FILE_ONLY_KINDS.includes(kind)) return 0;
    const table = tableFor(kind);
    const count = async (url: string): Promise<number> =>
      totalOf(await this.request(url, { method: "HEAD", extra: { Prefer: "count=exact" } }, table), table);
    let total = await count(this.filter(table));
    if (kind === "comments") for (const q of await this.othersCommentQueries()) total += await count(q);
    return total;
  }

  /**
   * Providers with an owner-scoped secret row, one per SECRET_TABLES entry that has rows. A failed or
   * total-less count throws, so the export refuses rather than reading an unknown as "no secrets".
   */
  async secretProviders(): Promise<string[]> {
    const uid = encodeURIComponent(this.opts.userId);
    const providers: string[] = [];
    for (const { table, select, owner, secret, provider } of SECRET_TABLES) {
      const url = `${this.opts.baseUrl}/${table}?select=${select}&${owner}=eq.${uid}&${secret}=not.is.null`;
      const res = await this.request(url, { method: "HEAD", extra: { Prefer: "count=exact" } }, table);
      if (totalOf(res, table) > 0) providers.push(provider);
    }
    return providers;
  }

  async pendingOutbox(): Promise<number> {
    if (!this.opts.pendingOutbox) throw new Error(`pendingOutbox ${NOT_WIRED}`);
    return this.opts.pendingOutbox();
  }

  /**
   * Always 0. db/migrations/0099_drop_e2ee_schema.sql:22-31 drops content_enc (and enc_epoch) from every entity
   * table the export reads, so the server holds no ciphertext rows to count. No request is sent.
   */
  async undecryptable(_kind: string): Promise<number> {
    return 0;
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
    // Reuse the base header key's casing so the merged headers carry one content-type, not two.
    const ctKey = Object.keys(this.opts.headers).find((k) => k.toLowerCase() === "content-type") ?? "content-type";
    await this.request(
      `${this.opts.baseUrl}/rpc/mark_exported_097`,
      { method: "POST", body: "{}", extra: { [ctKey]: "application/json" } },
      "rpc/mark_exported_097",
    );
  }
}
