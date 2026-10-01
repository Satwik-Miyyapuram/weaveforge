import type { Outbox, OutboxEntry } from "./outbox";
import type { ConflictStore } from "./conflicts";
import type { SendOutcome, SyncTransport } from "./sync-ports";

/**
 * Drains the outbox, in order, and stops at the first thing it cannot send.
 *
 * Order is the point. If op 3 fails and op 4 is sent anyway, the server sees an
 * edit to a row it was never told about, and the outcome depends on which
 * request happened to win — so the pump treats a stall as a stall and leaves
 * everything behind it alone.
 *
 * A conflict is not a failure and does not stop the run: it is a fact about one
 * row, merged here when the server's row is at hand, while other rows keep flowing.
 */

export interface PumpResult {
  sent: number;
  /**
   * Ops the server says it has a newer version of, for the merge step.
   *
   * `null` when the transport could not read which version the server holds.
   * That is a different fact from "version 0", and it must stay different all
   * the way to the conflict row: a fabricated 0 comes back as the next
   * attempt's `baseVersion` and produces a guard no row can satisfy.
   */
  conflicts: { entry: OutboxEntry; serverVersion: number | null }[];
  /** Why the run stopped early, if it did. */
  stoppedBecause: "offline" | null;
}

export class OutboxPump {
  constructor(
    private readonly outbox: Outbox,
    private readonly transport: SyncTransport,
    /**
     * Where an op refused as stale is written down. Optional, because the pump
     * is useful before there is anything to merge: a device that has never
     * conflicted needs no conflict store to run.
     */
    private readonly conflicts?: ConflictStore,
  ) {}

  async run(limit = 100): Promise<PumpResult> {
    const result: PumpResult = { sent: 0, conflicts: [], stoppedBecause: null };
    // A row whose op stalled sends nothing more this run: a later op would guard on a stale base.
    const stalled = new Set<string>();
    for (const entry of await this.outbox.pending(limit)) {
      const key = `${entry.table}:${entry.rowId}`;
      if (stalled.has(key)) continue;
      const outcome = await this.attempt(entry);
      if (outcome.status === "offline") {
        result.stoppedBecause = "offline";
        break;
      }
      if (outcome.status === "accepted") {
        await this.outbox.settleSent(entry, outcome.newVersion);
        if (outcome.newVersion != null && entry.op !== "delete") {
          await this.outbox.ack(entry.table, entry.rowId, outcome.newVersion);
        }
        result.sent += 1;
        continue;
      }
      stalled.add(key);
      if (outcome.status === "conflict") {
        result.conflicts.push({ entry, serverVersion: outcome.serverVersion });
        await this.conflict(entry, outcome.serverVersion, outcome.serverRow);
        continue;
      }
      await this.outbox.fail(entry.opId, outcome.reason);
    }
    return result;
  }

  /**
   * Stale op: merge three ways now when the server's row came back with the
   * refusal, rather than waiting for a pull that may already be past it.
   */
  private async conflict(
    entry: OutboxEntry,
    serverVersion: number | null,
    serverRow: Record<string, unknown> | null | undefined,
  ): Promise<void> {
    // Delete wins over an edit made elsewhere: re-aim at the version the server holds.
    if (entry.op === "delete") {
      if (serverVersion != null) await this.outbox.rebase(entry.table, entry.rowId, serverVersion);
      await this.outbox.fail(entry.opId, "Deleted here, edited elsewhere; retrying the delete.");
      return;
    }
    // Updated row gone from the server: their delete wins, as ours does.
    if (serverRow === null && entry.op === "update") {
      await this.outbox.dropRow(entry.table, entry.rowId);
      return;
    }
    if (!this.conflicts || !serverRow) {
      await this.outbox.fail(
        entry.opId,
        serverVersion == null
          ? "A newer version on the server."
          : `Newer version ${serverVersion} on the server.`,
      );
      return;
    }
    await this.conflicts.openFor(entry.table, entry.rowId, serverVersion);
    await this.conflicts.applyRemote(entry.table, serverRow);
    await this.conflicts.settle(entry.table, entry.rowId, serverRow, serverVersion);
  }

  /**
   * A transport that throws is offline as far as this is concerned.
   *
   * Anything else would need the pump to know which errors mean "no network"
   * across fetch, PostgREST and the shell — and guessing wrong in the other
   * direction burns an attempt on an op that was never actually refused.
   */
  private async attempt(entry: OutboxEntry): Promise<SendOutcome> {
    try {
      return await this.transport.send(entry);
    } catch {
      return { status: "offline" };
    }
  }
}
