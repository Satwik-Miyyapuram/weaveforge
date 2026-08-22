import type { OutboxEntry } from "./outbox";

/**
 * What the sync engine needs from the network, and nothing more.
 *
 * Two verbs — send an op, read the feed — so the engine can be tested against a
 * transport that refuses, stalls, or answers out of order without a server
 * being involved. The real one talks PostgREST; that belongs in infrastructure.
 */

/**
 * What became of an op.
 *
 * `conflict` is separate from `refused` because they call for opposite
 * responses: a conflict means the server has a newer version and the local edit
 * needs merging, while a refusal means this op will never be accepted and
 * retrying it is noise. `offline` is neither — the op is still owed.
 */
export type SendOutcome =
  | { status: "accepted" }
  | { status: "conflict"; serverVersion: number }
  | { status: "refused"; reason: string }
  | { status: "offline" };

export interface RemoteChange {
  table: string;
  rowId: string;
  serverSeq: number;
  deletedAt: string | null;
  rowVersion: number;
  row: Record<string, unknown>;
}

export interface SyncTransport {
  send(entry: OutboxEntry): Promise<SendOutcome>;
  /** Changes strictly after `since`, in watermark order. */
  changesSince(since: number, limit: number): Promise<RemoteChange[]>;
}
