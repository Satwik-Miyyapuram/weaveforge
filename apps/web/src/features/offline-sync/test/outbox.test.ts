import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { Outbox, OUTBOX_MAX_ATTEMPTS } from "../domain/outbox";
import { SyncStateStore } from "../domain/sync-state";
import { localSqlDb, type LocalSqlDb } from "./local-sql";

const open: LocalSqlDb[] = [];
after(async () => {
  for (const db of open) await db.close();
});

async function outbox(): Promise<{ box: Outbox; db: LocalSqlDb }> {
  const db = await localSqlDb();
  open.push(db);
  return { box: new Outbox(db), db };
}

const ROW = "00000000-0000-4000-8000-00000000000a";

describe("the outbox", () => {
  it("keeps ops in the order they were made", async () => {
    const { box } = await outbox();
    await box.append({ table: "papers", rowId: ROW, op: "insert", payload: { title: "one" } });
    await box.append({ table: "papers", rowId: ROW, op: "update", baseVersion: 1 });
    const pending = await box.pending();
    assert.deepEqual(
      pending.map((e) => e.op),
      ["insert", "update"],
    );
    assert.ok(pending[0]!.seq < pending[1]!.seq);
  });

  it("gives every op an id, so sending it twice is safe", async () => {
    const { box } = await outbox();
    const first = await box.append({ table: "papers", rowId: ROW, op: "insert" });
    const second = await box.append({ table: "papers", rowId: ROW, op: "insert" });
    assert.notEqual(first.opId, second.opId);
    assert.match(first.opId, /^[0-9a-f-]{36}$/);
  });

  it("carries the payload and the version the edit was based on", async () => {
    const { box } = await outbox();
    await box.append({ table: "papers", rowId: ROW, op: "update", payload: { title: "x" }, baseVersion: 7 });
    const [entry] = await box.pending();
    assert.deepEqual(entry!.payload, { title: "x" });
    assert.equal(entry!.baseVersion, 7);
  });

  it("drops an op once the server has taken it", async () => {
    const { box } = await outbox();
    const entry = await box.append({ table: "papers", rowId: ROW, op: "insert" });
    await box.settle(entry.opId);
    assert.deepEqual(await box.pending(), []);
  });

  it("stops retrying after enough failures, and keeps the op", async () => {
    const { box } = await outbox();
    const entry = await box.append({ table: "papers", rowId: ROW, op: "insert" });
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS; i += 1) await box.fail(entry.opId, "refused");
    assert.deepEqual(await box.pending(), []);
    const dead = await box.dead();
    assert.equal(dead.length, 1);
    assert.equal(dead[0]!.lastError, "refused");
    assert.equal(dead[0]!.attempts, OUTBOX_MAX_ATTEMPTS);
  });

  it("keeps retrying while there are attempts left", async () => {
    const { box } = await outbox();
    const entry = await box.append({ table: "papers", rowId: ROW, op: "insert" });
    await box.fail(entry.opId, "offline");
    assert.equal((await box.pending()).length, 1);
  });

  it("puts a dead op back in the queue unchanged", async () => {
    const { box } = await outbox();
    const entry = await box.append({ table: "papers", rowId: ROW, op: "insert", payload: { a: 1 } });
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS; i += 1) await box.fail(entry.opId, "refused");
    await box.revive(entry.opId);
    const [revived] = await box.pending();
    assert.equal(revived!.opId, entry.opId);
    assert.equal(revived!.attempts, 0);
    assert.deepEqual(revived!.payload, { a: 1 });
  });
});

describe("the sync watermark", () => {
  it("starts at nothing read and nobody signed in", async () => {
    const db = await localSqlDb();
    open.push(db);
    assert.deepEqual(await new SyncStateStore(db).read(), {
      watermark: 0,
      lastPullAt: null,
      accountId: null,
    });
  });

  it("moves forward only", async () => {
    const db = await localSqlDb();
    open.push(db);
    const state = new SyncStateStore(db);
    await state.advance(42);
    await state.advance(7);
    assert.equal((await state.read()).watermark, 42);
  });

  it("records the account this device was adopted by", async () => {
    const db = await localSqlDb();
    open.push(db);
    const state = new SyncStateStore(db);
    const account = "00000000-0000-4000-8000-0000000000bb";
    await state.adopt(account);
    assert.equal((await state.read()).accountId, account);
  });
});

describe("settling what was sent", () => {
  it("removes an op the server took unchanged", async () => {
    const { box } = await outbox();
    const sent = await box.append({ table: "papers", rowId: ROW, op: "insert", payload: { title: "one" } });
    await box.settleSent(sent, 1);
    assert.deepEqual(await box.pending(), []);
  });

  it("keeps an edit made during the send, now an update on the server's version", async () => {
    const { box, db } = await outbox();
    const sent = await box.append({ table: "papers", rowId: ROW, op: "insert", payload: { title: "one" } });
    // The capture trigger coalesces a later edit into the op in flight.
    await db.exec("update sync_outbox set payload = $2::jsonb where op_id = $1", [
      sent.opId,
      JSON.stringify({ title: "two" }),
    ]);

    await box.settleSent(sent, 1);

    const [left] = await box.pending();
    assert.equal(left!.op, "update");
    assert.equal(left!.baseVersion, 1);
    assert.deepEqual(left!.basePayload, { title: "one" });
    assert.deepEqual(left!.payload, { title: "two" });
  });

  it("acks a version onto the local row and the ops still owed for it", async () => {
    const { box, db } = await outbox();
    await db.exec("create table if not exists sync_tables (table_name text primary key)");
    await db.exec("create table if not exists public.projects (id uuid primary key, row_version int)");
    await db.exec("insert into sync_tables values ('projects') on conflict do nothing");
    await db.exec("insert into public.projects values ($1, 4)", [ROW]);
    await box.append({ table: "projects", rowId: ROW, op: "update", payload: {}, baseVersion: 4 });

    await box.ack("projects", ROW, 2);

    const row = await db.queryOne<{ row_version: number }>(
      "select row_version from public.projects where id = $1",
      [ROW],
    );
    assert.equal(row!.row_version, 2);
    assert.equal((await box.pending())[0]!.baseVersion, 2);
  });
});
