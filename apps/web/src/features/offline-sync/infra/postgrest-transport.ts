import { errorMessage } from "@weaveforge/core";
import { logToApp } from "@/lib/error-report/app-log";
import { readyCore } from "@/lib/rust-core";
import type { OutboxEntry } from "../domain/parts-2";
import type { RemoteChange, SendOutcome, SyncTransport } from "../domain/parts";

/**
 * What the transport needs to reach PostgREST.
 *
 * Plain fetch rather than the data client: the query builder's return type
 * hides the HTTP status, which is a decision here, not a detail.
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

/** One request as wf-core builds it (`postgrest_transport::RequestSpec`). */
interface RequestSpec {
  method: string;
  path: string;
  body?: string;
  prefer?: string;
}

/** A reply. Status `0` with an empty body stands for a read that never answered. */
interface Reply {
  status: number;
  body: string;
}

/** wf-core's `send_steps::SendStep`: finished, or one more read with the state to resume from. */
type SendStep =
  | { next: "done"; outcome: SendOutcome }
  | { next: "read"; request: RequestSpec; state: unknown };

/** wf-core's `send_steps::PresenceStep` for one missing-id chunk. */
type PresenceStep =
  | { next: "failed" }
  | { next: "done"; missing: string[] }
  | { next: "tombstones"; request: RequestSpec; held: string[] };

/** A payload JSON cannot encode must fail here, before the request (xlog-03). Rust reads a BigInt as a number. */
function assertEncodable(payload: Record<string, unknown> | undefined): void {
  if (payload) JSON.stringify(payload);
}

export class PostgrestTransport implements SyncTransport {
  constructor(private readonly config: PostgrestConfig) {}

  async send(entry: OutboxEntry): Promise<SendOutcome> {
    let reply: Reply;
    try {
      reply = await this.dispatch(entry);
    } catch (err) {
      // Either way the op is still owed, so it must not burn an attempt. But
      // only a request that got no answer is the network; anything else (a
      // session that cannot be read, a payload that cannot be encoded) is a
      // fault that would otherwise stall the queue without a word (xlog-03).
      if (!(err instanceof NetworkFailure)) (this.config.onSendError ?? logSendError)(err);
      return { status: "offline" };
    }
    // Every decision (status verdict, follow-up reads, conflict and tombstone rules) is wf-core's `send_steps`.
    let step = readyCore().sendStart(reply.status, reply.body, entry.op, entry.table, entry.rowId) as SendStep;
    while (step.next === "read") {
      const answer = await this.readOrBlank(step.request);
      step = readyCore().sendAdvance(step.state, answer.status, answer.body) as SendStep;
    }
    return step.outcome;
  }

  async changesSince(since: number, limit: number): Promise<RemoteChange[]> {
    const reply = await this.fetchReply(readyCore().postgrestChangesRequest(since, limit) as RequestSpec);
    const result = readyCore().changesFromReply(reply.status, reply.body) as {
      error: string | null;
      changes: RemoteChange[];
    };
    if (result.error !== null) throw new Error(result.error);
    return result.changes;
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
    try {
      const missing: string[] = [];
      for (const chunk of readyCore().missingIdChunks(ids) as string[][]) {
        const found = await this.readOrBlank(readyCore().postgrestPresenceRequest(table, chunk) as RequestSpec);
        const presence = readyCore().missingAfterPresence(table, chunk, found.status, found.body) as PresenceStep;
        if (presence.next === "failed") return null;
        if (presence.next === "done") {
          missing.push(...presence.missing);
          continue;
        }
        const buried = await this.readOrBlank(presence.request);
        const chunkMissing = readyCore().missingAfterTombstones(chunk, presence.held, buried.status, buried.body) as
          | string[]
          | null;
        if (chunkMissing === null) return null;
        missing.push(...chunkMissing);
      }
      return missing;
    } catch {
      return null;
    }
  }

  /** The write itself. Each op shape guards on the version it was based on. */
  private dispatch(entry: OutboxEntry): Promise<Reply> {
    if (entry.op !== "delete") assertEncodable(entry.payload);
    // The shape of each op (POST, guarded PATCH or DELETE, path and prefer header) is wf-core's `postgrest_transport::write_request`.
    return this.fetchReply(
      readyCore().postgrestWriteRequest(
        entry.op,
        entry.table,
        entry.rowId,
        entry.baseVersion ?? undefined,
        entry.payload ?? undefined,
      ) as RequestSpec,
    );
  }

  /** A read whose failure is not an answer: any error becomes status `0`, which wf-core reads as "not answered". */
  private async readOrBlank(spec: RequestSpec): Promise<Reply> {
    try {
      return await this.fetchReply(spec);
    } catch {
      return { status: 0, body: "" };
    }
  }

  /** Sends one request built by wf-core and returns its reply. The fetch and its network failure stay here. */
  private async fetchReply(spec: RequestSpec): Promise<Reply> {
    const token = await this.config.accessToken();
    const doFetch = this.config.fetchImpl ?? fetch;
    const init = readyCore().postgrestRequestInit(spec, this.config.apiKey, token ?? undefined) as RequestInit;
    let response: Response;
    let text: string;
    try {
      response = await doFetch(`${this.config.baseUrl}${spec.path}`, init);
      text = await response.text();
    } catch (err) {
      throw new NetworkFailure(err);
    }
    return { status: response.status, body: text };
  }
}
