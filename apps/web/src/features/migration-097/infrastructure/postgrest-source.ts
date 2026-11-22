import type { BlobRef, Row, ServerSource } from "../domain/ports";
import { PAGE_SIZE, listAllPages } from "./paging";

/** camelCase kind -> snake_case PostgREST table. */
export const TABLE_BY_KIND = {
  logEntries: "log_entries",
  reportSections: "report_sections",
  readingLists: "reading_lists",
  paperFields: "paper_fields",
  annotationPins: "annotation_pins",
  libraryPins: "library_pins",
  aiProposals: "ai_proposals",
} as const;

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
const BLOB_NOT_IMPLEMENTED = "blob listing not implemented: export incomplete";
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

  private filter(table: string): string {
    return `${this.opts.baseUrl}/${table}?user_id=eq.${this.opts.userId}&deleted_at=is.null`;
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

  async listRows(kind: string): Promise<Row[]> {
    const table = tableFor(kind);
    const rows = await listAllPages<Row>(async (offset, limit) => {
      const url = `${this.filter(table)}&order=id.asc&limit=${limit}&offset=${offset}`;
      const res = await this.request(url, { method: "GET" }, table);
      return (await res.json()) as Row[];
    }, PAGE_SIZE);
    return rows.map(toCamelRow);
  }

  async countRows(kind: string): Promise<number> {
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

  async listBlobs(): Promise<BlobRef[]> {
    throw new Error(BLOB_NOT_IMPLEMENTED);
  }

  /** Downloads through a signed URL. The caller checks the sha256 against the ref. */
  async fetchBlob(ref: BlobRef): Promise<Uint8Array> {
    if (!this.opts.signedUrl) throw new Error(SIGNED_URL_NOT_WIRED);
    const url = await this.opts.signedUrl(ref.bucket, ref.path);
    if (!url) throw new Error(`no signed url for ${ref.bucket}/${ref.path}`);
    const res = await this.opts.fetch(url);
    if (!res.ok) throw new Error(`blob download failed: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async markExported(at: string): Promise<void> {
    const url = `${this.opts.baseUrl}/profiles?user_id=eq.${this.opts.userId}`;
    await this.request(
      url,
      {
        method: "PATCH",
        body: JSON.stringify({ exported_097_at: at }),
        extra: { "Content-Type": "application/json", Prefer: "return=minimal" },
      },
      "profiles",
    );
  }
}
