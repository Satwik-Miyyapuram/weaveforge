import type { OutboxEntry } from "../domain/outbox";
import type { RemoteChange, SendOutcome, SyncTransport } from "../domain/sync-ports";

/**
 * What the transport needs to reach PostgREST.
 *
 * Plain fetch rather than the Supabase client: the query builder's return type
 * hides the two facts this code turns on — the HTTP status, and how many rows a
 * guarded PATCH actually touched. Both are decisions here, not details.
 */
export interface PostgrestConfig {
  /** REST root, e.g. `https://project.supabase.co/rest/v1`. No trailing slash. */
  baseUrl: string;
  apiKey: string;
  /** The current session token, read per request because it expires. */
  accessToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

/** A row the server rejected outright, versus one it could not reach. */
interface Attempt {
  status: number;
  body: string;
  rows: unknown[] | null;
}

export class PostgrestTransport implements SyncTransport {
  constructor(private readonly config: PostgrestConfig) {}

  async send(entry: OutboxEntry): Promise<SendOutcome> {
    let attempt: Attempt;
    try {
      attempt = await this.dispatch(entry);
    } catch {
      // A thrown fetch is a network fact, not a verdict on the op: the op is
      // still owed, so it must not burn an attempt.
      return { status: "offline" };
    }
    if (attempt.status === 409) return this.conflict(entry);
    // 5xx is the server having a bad moment. Retrying is right; dead-lettering
    // an op because a deploy was in flight is not.
    if (attempt.status >= 500) return { status: "offline" };
    if (attempt.status === 401 || attempt.status === 403) return { status: "offline" };
    if (attempt.status >= 400) return { status: "refused", reason: firstLine(attempt.body) };
    // A guarded write that matched nothing means the base version moved on.
    if (attempt.rows !== null && attempt.rows.length === 0) return this.conflict(entry);
    return { status: "accepted" };
  }

  async changesSince(since: number, limit: number): Promise<RemoteChange[]> {
    const response = await this.request("POST", `/rpc/sync_changes`, {
      p_since: since,
      p_limit: limit,
    });
    if (response.status >= 400) {
      throw new Error(`sync_changes failed (${response.status}): ${firstLine(response.body)}`);
    }
    const rows = Array.isArray(response.rows) ? response.rows : [];
    return rows.map((row) => toChange(row as Record<string, unknown>));
  }

  /** The write itself. Each op shape guards on the version it was based on. */
  private dispatch(entry: OutboxEntry): Promise<Attempt> {
    const table = encodeURIComponent(entry.tableName);
    if (entry.op === "insert") {
      return this.request("POST", `/${table}`, entry.payload ?? {}, "return=representation");
    }
    const guard = `?id=eq.${encodeURIComponent(entry.rowId)}&row_version=eq.${entry.baseVersion ?? 0}`;
    const body =
      entry.op === "delete" ? { deleted_at: new Date().toISOString() } : (entry.payload ?? {});
    return this.request("PATCH", `/${table}${guard}`, body, "return=representation");
  }

  /**
   * Read back the version the server holds, so the merge has both sides.
   *
   * If the row cannot be read the op is still a conflict — version 0 says "the
   * server has something you have not seen", which is exactly true.
   */
  private async conflict(entry: OutboxEntry): Promise<SendOutcome> {
    try {
      const table = encodeURIComponent(entry.tableName);
      const found = await this.request(
        "GET",
        `/${table}?id=eq.${encodeURIComponent(entry.rowId)}&select=row_version`,
      );
      const row = Array.isArray(found.rows) ? found.rows[0] : undefined;
      const version = (row as { row_version?: unknown } | undefined)?.row_version;
      return { status: "conflict", serverVersion: typeof version === "number" ? version : 0 };
    } catch {
      return { status: "conflict", serverVersion: 0 };
    }
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    prefer?: string,
  ): Promise<Attempt> {
    const token = await this.config.accessToken();
    const doFetch = this.config.fetchImpl ?? fetch;
    const response = await doFetch(`${this.config.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        apikey: this.config.apiKey,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(prefer ? { prefer } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text, rows: parseRows(text) };
  }
}

function parseRows(text: string): unknown[] | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** PostgREST errors are JSON; the message is the part worth keeping. */
function firstLine(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    // Not JSON — fall through to the raw text.
  }
  return body.slice(0, 200);
}

function toChange(row: Record<string, unknown>): RemoteChange {
  return {
    table: String(row.table_name),
    rowId: String(row.row_id),
    serverSeq: Number(row.server_seq),
    deletedAt: (row.deleted_at as string | null) ?? null,
    rowVersion: Number(row.row_version),
    row: (row.row_data as Record<string, unknown>) ?? {},
  };
}
