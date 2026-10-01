import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { Outbox } from "../domain/outbox";
import { OutboxPump } from "../domain/pump";
import { ConflictStore } from "../domain/conflicts";
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

  it("stalls a conflicting row but keeps sending the others", async () => {
    const outbox = await withOps(2);
    const OTHER = "00000000-0000-4000-8000-00000000000b";
    await outbox.append({ table: "papers", rowId: OTHER, op: "update", payload: { n: 9 } });
    const seen: OutboxEntry[] = [];
    const pump = new OutboxPump(
      outbox,
      transport([{ status: "conflict", serverVersion: 9 }, { status: "accepted" }], seen),
    );
    const result = await pump.run();
    assert.equal(result.sent, 1);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0]!.serverVersion, 9);
    // The row's later op waits behind its conflict; the other row went.
    assert.deepEqual(seen.map((e) => e.rowId), [ROW, OTHER]);
    assert.equal((await outbox.pending()).length, 2);
  });

  it("merges a conflict at once when the server's row came with it", async () => {
    const db = await localSqlDb();
    open.push(db);
    await db.exec("create table if not exists sync_tables (table_name text primary key)");
    await db.exec(
      "create table if not exists public.projects (id uuid primary key, title text, read boolean)",
    );
    await db.exec("insert into sync_tables values ('projects') on conflict do nothing");
    const outbox = new Outbox(db);
    const conflicts = new ConflictStore(db);
    const base = { id: ROW, title: "Draft", read: false };
    await outbox.append({
      table: "projects",
      rowId: ROW,
      op: "update",
      payload: { ...base, title: "Mine" },
      basePayload: base,
      baseVersion: 2,
    });
    const pump = new OutboxPump(
      outbox,
      transport([{ status: "conflict", serverVersion: 3, serverRow: { ...base, read: true } }]),
      conflicts,
    );

    await pump.run();

    assert.deepEqual(await conflicts.openConflicts(), []);
    const [entry] = await outbox.pending();
    assert.equal(entry!.baseVersion, 3);
    assert.deepEqual(entry!.payload, { id: ROW, title: "Mine", read: true });
  });

  it("drops an edit to a row the server no longer has", async () => {
    const outbox = await withOps(1);
    await new OutboxPump(
      outbox,
      transport([{ status: "conflict", serverVersion: null, serverRow: null }]),
    ).run();
    assert.deepEqual(await outbox.pending(), []);
  });

  it("keeps a delete that met a newer version, re-aimed at it", async () => {
    const db = await localSqlDb();
    open.push(db);
    const outbox = new Outbox(db);
    await outbox.append({ table: "papers", rowId: ROW, op: "delete", baseVersion: 2 });
    await new OutboxPump(outbox, transport([{ status: "conflict", serverVersion: 4 }])).run();
    const [entry] = await outbox.pending();
    assert.equal(entry!.op, "delete");
    assert.equal(entry!.baseVersion, 4);
  });

  it("records why a refused op failed", async () => {
    const outbox = await withOps(1);
    await new OutboxPump(outbox, transport([{ status: "refused", reason: "no such project" }])).run();
    assert.equal((await outbox.pending())[0]!.lastError, "no such project");
  });
});
