import { errorMessage } from "@weaveforge/core";
import { logToApp } from "@/lib/error-report/app-log";
import { readyCore } from "@/lib/rust-core";
import type { OutboxEntry } from "../domain/outbox";
import type { RemoteChange, SendOutcome, SyncTransport } from "../domain/sync-ports";

/**
 * What the transport needs to reach PostgREST.
 *
 * Plain fetch rather than the data client: the query builder's return type
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
  /** A send failed for a reason other than the network. Defaults to the app log. */
  onSendError?: (err: unknown) => void;
}

/** The request never got an answer: no network, a dropped connection, an abort. */
class NetworkFailure extends Error {
  constructor(cause: unknown) {
    super(errorMessage(cause), { cause });
  }
}

function logSendError(err: unknown): void {
  logToApp({
    level: "error",
    source: "sync",
    message: "Sync send failed before reaching the server",
    detail: err instanceof Error ? (err.stack ?? err.message) : String(err),
  });
}

/** A row the server rejected outright, versus one it could not reach. */
interface Attempt {
  status: number;
  body: string;
  rows: unknown[] | null;
}

/** The write's columns minus the table's generated ones (wf-core `postgrest_wire::writable`). */
function writable(table: string, payload: Record<string, unknown> | undefined): Record<string, unknown> {
  // Rust reads a BigInt as a number, so an unencodable payload must fail here as the JSON body did before the port (xlog-03).
  if (payload) JSON.stringify(payload);
  return readyCore().postgrestWritable(table, payload ?? null) as Record<string, unknown>;
}

/** Postgres code and reason of an error body (wf-core `postgrest_wire::error_info`). */
function readError(body: string): { code: string | null; firstLine: string } {
  return readyCore().postgrestErrorInfo(body) as { code: string | null; firstLine: string };
}

export class PostgrestTransport implements SyncTransport {
  constructor(private readonly config: PostgrestConfig) {}

  async send(entry: OutboxEntry): Promise<SendOutcome> {
    let attempt: Attempt;
    try {
      attempt = await this.dispatch(entry);
    } catch (err) {
      // Either way the op is still owed, so it must not burn an attempt. But
      // only a request that got no answer is the network; anything else (a
      // session that cannot be read, a payload that cannot be encoded) is a
      // fault that would otherwise stall the queue without a word (xlog-03).
      if (!(err instanceof NetworkFailure)) (this.config.onSendError ?? logSendError)(err);
      return { status: "offline" };
    }
    // The status decision lives in wf-core (`sync::send_verdict::classify_send`).
    // Only the follow-up reads (conflict, gone) and the body's error fields stay here.
    const error = attempt.status >= 400 ? readError(attempt.body) : { code: null, firstLine: "" };
    const verdict = readyCore().classifySend(
      attempt.status,
      error.code,
      attempt.rows === null ? null : attempt.rows.length,
    );
    switch (verdict) {
      // A missing parent is not a conflict over this row: nothing sits at its id,
      // and read as one the insert was dropped. Refused, it is kept and retried
      // once the parent has gone up.
      case "awaiting_parent":
        return { status: "refused", reason: error.firstLine, awaitingParent: true };
      case "conflict": {
        const outcome = await this.conflict(entry);
        // paper_tags ids hash the key, so a duplicate insert is the same link another device already made.
        if (readyCore().isLinkInsert(entry.op, entry.table) && outcome.status === "conflict" && outcome.serverRow) {
          return outcome.serverVersion == null
            ? { status: "accepted" }
            : { status: "accepted", newVersion: outcome.serverVersion };
        }
        return outcome;
      }
      // 5xx is the server having a bad moment, and 401/403 is about the session.
      // Retrying is right; dead-lettering an op because a deploy was in flight is not.
      case "offline":
        return { status: "offline" };
      // A row-level-security refusal arrives as 403 but is a verdict on this row,
      // not on the session: refused, it burns an attempt and the ops behind it still go.
      case "rls_refused":
      case "refused":
        return { status: "refused", reason: error.firstLine };
      // A guarded write that matched nothing means the base version moved on —
      // unless it was a delete and the row is already gone, which is the outcome
      // the delete wanted.
      case "guard_missed":
        if (entry.op === "delete" && (await this.gone(entry))) return { status: "accepted" };
        return this.conflict(entry);
      case "accepted": {
        const version = (attempt.rows?.[0] as { row_version?: unknown } | undefined)?.row_version;
        return typeof version === "number" ? { status: "accepted", newVersion: version } : { status: "accepted" };
      }
    }
  }

  async changesSince(since: number, limit: number): Promise<RemoteChange[]> {
    const response = await this.request("POST", `/rpc/sync_changes`, {
      p_since: since,
      p_limit: limit,
    });
    if (response.status >= 400) {
      throw new Error(`sync_changes failed (${response.status}): ${readError(response.body).firstLine}`);
    }
    const rows = Array.isArray(response.rows) ? response.rows : [];
    return rows.map((row) => toChange(row as Record<string, unknown>));
  }

  /** The write itself. Each op shape guards on the version it was based on. */
  private dispatch(entry: OutboxEntry): Promise<Attempt> {
    const table = encodeURIComponent(entry.table);
    if (entry.op === "insert") {
      return this.request("POST", `/${table}`, writable(entry.table, entry.payload), "return=representation");
    }
    // Guard only on a version we actually hold. An unknown base version used to
    // be spelled `?? 0`, which turns "we never recorded one" into a specific and
    // wrong claim: no live row is at version 0, so the PATCH matched nothing and
    // `send` read that as a conflict — an op that could never drain. Last write
    // wins is the honest reading of "no version to compare against"; if an
    // unguarded write is unacceptable for a caller, the op belongs in the
    // `refused` outcome with a reason, not parked as a phantom conflict.
    const row = `?id=eq.${encodeURIComponent(entry.rowId)}`;
    const guard =
      entry.baseVersion == null ? row : `${row}&row_version=eq.${entry.baseVersion}`;
    // A real DELETE, not a `deleted_at` stamp: no screen filters on that
    // column, so a stamped row stayed on every other device and on the web.
    if (entry.op === "delete") {
      return this.request("DELETE", `/${table}${guard}`, undefined, "return=representation");
    }
    return this.request("PATCH", `/${table}${guard}`, writable(entry.table, entry.payload), "return=representation");
  }

  /**
   * Which of these ids the server never received. Null when that cannot be
   * read: a failed read is not proof the rows are missing.
   *
   * A row deleted on another device is absent too, and this runs before the
   * pull that would delete it here. Sent again, it would come back to life on
   * every device, so ids the server records deleting are left out.
   */
  async missingIds(table: string, ids: string[]): Promise<string[] | null> {
    const missing: string[] = [];
    for (let i = 0; i < ids.length; i += MISSING_IDS_CHUNK) {
      const chunk = ids.slice(i, i + MISSING_IDS_CHUNK);
      try {
        const found = await this.request(
          "GET",
          `/${encodeURIComponent(table)}?id=in.(${chunk.map(encodeURIComponent).join(",")})&select=id`,
        );
        if (found.status >= 400 || !Array.isArray(found.rows)) return null;
        const held = found.rows.map((r) => String((r as { id?: unknown }).id));
        const absent = chunk.filter((id) => !held.includes(id));
        if (absent.length === 0) continue;
        const buried = await this.request(
          "GET",
          `/sync_tombstones?table_name=eq.${encodeURIComponent(table)}&row_id=in.(${absent.map(encodeURIComponent).join(",")})&select=row_id`,
        );
        if (buried.status >= 400 || !Array.isArray(buried.rows)) return null;
        const deleted = buried.rows.map((r) => String((r as { row_id?: unknown }).row_id));
        missing.push(...readyCore().missingIds(chunk, held, deleted));
      } catch {
        return null;
      }
    }
    return missing;
  }

  /** Whether the row is absent on the server. A failed read is not proof. */
  private async gone(entry: OutboxEntry): Promise<boolean> {
    try {
      const found = await this.request(
        "GET",
        `/${encodeURIComponent(entry.table)}?id=eq.${encodeURIComponent(entry.rowId)}&select=id`,
      );
      return found.status < 400 && Array.isArray(found.rows) && found.rows.length === 0;
    } catch {
      return false;
    }
  }

  /**
   * Read back the version the server holds, so the merge has both sides.
   *
   * `serverVersion: null` — not `0` — when it cannot be read. The distinction is
   * not cosmetic: this value is persisted on the conflict row and re-queued as
   * the next attempt's `baseVersion`, so a fabricated 0 becomes a guard that
   * matches nothing and dead-letters the op. "The server has something you have
   * not seen" is true without knowing which version it is.
   */
  private async conflict(entry: OutboxEntry): Promise<SendOutcome> {
    try {
      const table = encodeURIComponent(entry.table);
      const found = await this.request(
        "GET",
        `/${table}?id=eq.${encodeURIComponent(entry.rowId)}&select=*`,
      );
      const row = (Array.isArray(found.rows) ? found.rows[0] : undefined) as
        | Record<string, unknown>
        | undefined;
      const version = row?.row_version;
      const serverVersion = typeof version === "number" ? version : null;
      // An unreadable answer says nothing about the row; leave it out rather than claim "gone".
      if (found.status >= 400 || !Array.isArray(found.rows)) return { status: "conflict", serverVersion };
      if (row) return { status: "conflict", serverVersion, serverRow: row };
      const deletedElsewhere = await this.tombstoned(entry);
      return {
        status: "conflict",
        serverVersion,
        serverRow: null,
        ...(deletedElsewhere === null ? {} : { deletedElsewhere }),
      };
    } catch {
      return { status: "conflict", serverVersion: null };
    }
  }

  /**
   * Whether the server records deleting this row: no row there can mean
   * deleted elsewhere or never received, and only one of those may drop an edit.
   * `null` when the answer could not be read.
   */
  private async tombstoned(entry: OutboxEntry): Promise<boolean | null> {
    try {
      const found = await this.request(
        "GET",
        `/sync_tombstones?table_name=eq.${encodeURIComponent(entry.table)}&row_id=eq.${encodeURIComponent(entry.rowId)}&select=row_id`,
      );
      if (found.status >= 400 || !Array.isArray(found.rows)) return null;
      return found.rows.length > 0;
    } catch {
      return null;
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
    const init: RequestInit = {
      method,
      headers: {
        "content-type": "application/json",
        apikey: this.config.apiKey,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(prefer ? { prefer } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
    let response: Response;
    let text: string;
    try {
      response = await doFetch(`${this.config.baseUrl}${path}`, init);
      text = await response.text();
    } catch (err) {
      throw new NetworkFailure(err);
    }
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

/** Ids per `in.(...)` read; a hundred uuids keep the URL well under any limit. */
const MISSING_IDS_CHUNK = 100;

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
