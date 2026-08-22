import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { Outbox } from "../domain/outbox";
import { OutboxPump } from "../domain/pump";
import type { OutboxEntry } from "../domain/outbox";
import type { SendOutcome, SyncTransport } from "../domain/sync-ports";
import { localSqlDb, type LocalSqlDb } from "./local-sql";

const open: LocalSqlDb[] = [];
after(async () => {
  for (const db of open) await db.close();
});

const ROW = "00000000-0000-4000-8000-00000000000a";

/** A transport that answers from a script, and records what it was asked. */
function transport(outcomes: SendOutcome[], seen: OutboxEntry[] = []): SyncTransport {
  return {
    send: async (entry) => {
      seen.push(entry);
      return outcomes.shift() ?? { status: "accepted" };
    },
    changesSince: async () => [],
  };
}

async function withOps(count: number) {
  const db = await localSqlDb();
  open.push(db);
  const outbox = new Outbox(db);
  for (let i = 0; i < count; i += 1) {
    await outbox.append({ table: "papers", rowId: ROW, op: "update", payload: { n: i } });
  }
  return outbox;
}

describe("the outbox pump", () => {
  it("sends in order and clears what the server took", async () => {
    const outbox = await withOps(3);
    const seen: OutboxEntry[] = [];
    const result = await new OutboxPump(outbox, transport([], seen)).run();
    assert.equal(result.sent, 3);
    assert.deepEqual(seen.map((e) => e.payload), [{ n: 0 }, { n: 1 }, { n: 2 }]);
    assert.deepEqual(await outbox.pending(), []);
  });

  it("stops at the first op it cannot send, leaving the rest untouched", async () => {
    const outbox = await withOps(3);
    const seen: OutboxEntry[] = [];
    const pump = new OutboxPump(outbox, transport([{ status: "accepted" }, { status: "offline" }], seen));
    const result = await pump.run();
    assert.equal(result.sent, 1);
    assert.equal(result.stoppedBecause, "offline");
    // Two asked about, two still owed: the third was never attempted, because
    // sending it would put an edit ahead of the op it depends on.
    assert.equal(seen.length, 2);
    assert.equal((await outbox.pending()).length, 2);
  });

  it("treats a thrown transport as offline rather than as a refusal", async () => {
    const outbox = await withOps(1);
    const pump = new OutboxPump(outbox, {
      send: async () => {
        throw new Error("network down");
      },
      changesSince: async () => [],
    });
    assert.equal((await pump.run()).stoppedBecause, "offline");
    assert.equal((await outbox.pending())[0]!.attempts, 0);
  });

  it("reports a conflict and keeps going", async () => {
    const outbox = await withOps(2);
    const pump = new OutboxPump(
      outbox,
      transport([{ status: "conflict", serverVersion: 9 }, { status: "accepted" }]),
    );
    const result = await pump.run();
    assert.equal(result.sent, 1);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0]!.serverVersion, 9);
    // Still owed: the merge decides its fate, not the pump.
    assert.equal((await outbox.pending()).length, 1);
  });

  it("records why a refused op failed", async () => {
    const outbox = await withOps(1);
    await new OutboxPump(outbox, transport([{ status: "refused", reason: "no such project" }])).run();
    assert.equal((await outbox.pending())[0]!.lastError, "no such project");
  });
});
