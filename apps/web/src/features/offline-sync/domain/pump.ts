import { Outbox, type OutboxEntry } from "./outbox";
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
 * row, handed to the caller to merge, while the ops behind it keep flowing.
 */

export interface PumpResult {
  sent: number;
  /** Ops the server says it has a newer version of, for the merge step. */
  conflicts: { entry: OutboxEntry; serverVersion: number }[];
  /** Why the run stopped early, if it did. */
  stoppedBecause: "offline" | null;
}

export class OutboxPump {
  constructor(
    private readonly outbox: Outbox,
    private readonly transport: SyncTransport,
  ) {}

  async run(limit = 100): Promise<PumpResult> {
    const result: PumpResult = { sent: 0, conflicts: [], stoppedBecause: null };
    for (const entry of await this.outbox.pending(limit)) {
      const outcome = await this.attempt(entry);
      if (outcome.status === "offline") {
        result.stoppedBecause = "offline";
        break;
      }
      if (outcome.status === "accepted") {
        await this.outbox.settle(entry.opId);
        result.sent += 1;
        continue;
      }
      if (outcome.status === "conflict") {
        result.conflicts.push({ entry, serverVersion: outcome.serverVersion });
        // Held, not dropped: the merge decides what happens to it, and until
        // then it is still work this device has not delivered.
        await this.outbox.fail(entry.opId, `Newer version ${outcome.serverVersion} on the server.`);
        continue;
      }
      await this.outbox.fail(entry.opId, outcome.reason);
    }
    return result;
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
