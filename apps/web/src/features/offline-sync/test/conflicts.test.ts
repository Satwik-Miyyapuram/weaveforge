import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { localSqlDb } from "./local-sql";
import { ConflictStore } from "../domain/conflicts";
import { Outbox } from "../domain/outbox";

const ROW = "00000000-0000-4000-8000-0000000e0001";

/** A synced table to merge into: the device-only migrations bring no app schema. */
async function store() {
  const db = await localSqlDb();
  await db.exec("create table if not exists sync_tables (table_name text primary key)");
  await db.exec(
    "create table if not exists public.projects (id uuid primary key, title text, read boolean)",
  );
  await db.exec("insert into sync_tables values ('projects') on conflict do nothing");
  return { db, outbox: new Outbox(db), conflicts: new ConflictStore(db) };
}

const base = { id: ROW, title: "Draft", read: false };

function edit(outbox: Outbox, title = "Mine") {
  return outbox.append({
    table: "projects",
    rowId: ROW,
    op: "update",
    payload: { ...base, title },
    basePayload: base,
    baseVersion: 2,
  });
}

describe("conflicts", () => {
  it("opens from what the device owes and takes over those ops", async () => {
    const { db, outbox, conflicts } = await store();
    await edit(outbox, "First");
    await edit(outbox, "Mine");

    await conflicts.openFor("projects", ROW, 5);

    const [open] = await conflicts.openConflicts();
    assert.deepEqual(open!.base, base);
    assert.equal(open!.local.title, "Mine");
    assert.equal(open!.remote, null);
    assert.equal(open!.serverVersion, 5);
    assert.deepEqual(await outbox.pending(), []);
    await db.close();
  });

  it("opens nothing for a row the device owes nothing for", async () => {
    const { db, conflicts } = await store();
    await conflicts.openFor("projects", ROW, 5);
    assert.deepEqual(await conflicts.openConflicts(), []);
    await db.close();
  });

  it("merges edits to different fields and queues the result on the server's version", async () => {
    const { db, outbox, conflicts } = await store();
    await edit(outbox);
    await conflicts.openFor("projects", ROW, 5);

    const merged = await conflicts.settle("projects", ROW, { ...base, read: true }, 5);

    assert.deepEqual(merged, { id: ROW, title: "Mine", read: true });
    assert.deepEqual(await conflicts.openConflicts(), []);
    const stored = await db.queryOne<{ title: string; read: boolean }>(
      "select title, read from public.projects where id = $1",
      [ROW],
    );
    assert.deepEqual({ ...stored }, { title: "Mine", read: true });
    const [entry] = await outbox.pending();
    assert.equal(entry!.op, "update");
    assert.equal(entry!.baseVersion, 5);
    assert.equal(entry!.payload.title, "Mine");
    await db.close();
  });

  it("queues nothing when the server already holds the merge", async () => {
    const { db, outbox, conflicts } = await store();
    await edit(outbox);
    await conflicts.openFor("projects", ROW, 5);

    await conflicts.settle("projects", ROW, { ...base, title: "Mine" }, 5);

    assert.deepEqual(await conflicts.openConflicts(), []);
    assert.deepEqual(await outbox.pending(), []);
    await db.close();
  });

  it("stays open, naming the colliding fields, when the sides disagree", async () => {
    const { db, outbox, conflicts } = await store();
    await edit(outbox);
    await conflicts.openFor("projects", ROW, 5);

    const merged = await conflicts.settle("projects", ROW, { ...base, title: "Theirs" }, 6);

    assert.equal(merged, null);
    const [open] = await conflicts.openConflicts();
    assert.deepEqual(open!.fields, [
      { field: "title", base: "Draft", local: "Mine", remote: "Theirs" },
    ]);
    assert.equal(open!.serverVersion, 6);
    assert.deepEqual(await outbox.pending(), []);
    await db.close();
  });

  it("treats a row both sides created as having an empty base", async () => {
    const { db, outbox, conflicts } = await store();
    await outbox.append({
      table: "projects",
      rowId: ROW,
      op: "insert",
      payload: { ...base, title: "Mine" },
    });
    await conflicts.openFor("projects", ROW, 1);

    const merged = await conflicts.settle("projects", ROW, { ...base, title: "Theirs" }, 1);

    assert.equal(merged, null);
    const [open] = await conflicts.openConflicts();
    assert.deepEqual(open!.fields.map((f) => f.field), ["title"]);
    await db.close();
  });

  it("keeps one open conflict per row, not one per attempt", async () => {
    const { db, outbox, conflicts } = await store();
    await edit(outbox);
    await conflicts.openFor("projects", ROW, 5);
    await edit(outbox, "Again");
    await conflicts.openFor("projects", ROW, 6);

    const open = await conflicts.openConflicts();
    assert.equal(open.length, 1);
    assert.equal(open[0]!.local.title, "Again");
    assert.equal(open[0]!.serverVersion, 6);
    await db.close();
  });

  it("a resolved conflict leaves the row free to conflict again", async () => {
    const { db, outbox, conflicts } = await store();
    await edit(outbox);
    await conflicts.openFor("projects", ROW, 5);
    const [first] = await conflicts.openConflicts();
    await conflicts.resolve(first!.id);

    await edit(outbox);
    await conflicts.openFor("projects", ROW, 7);

    const open = await conflicts.openConflicts();
    assert.equal(open.length, 1);
    assert.equal(open[0]!.serverVersion, 7);
    await db.close();
  });

  it("keeps a field only this device changed when the reader picks the cloud side", async () => {
    const { db, outbox, conflicts } = await store();
    await outbox.append({
      table: "projects",
      rowId: ROW,
      op: "update",
      payload: { ...base, title: "Mine", read: true },
      basePayload: base,
      baseVersion: 2,
    });
    await conflicts.openFor("projects", ROW, 5);
    await conflicts.settle("projects", ROW, { ...base, title: "Theirs" }, 6);
    const [open] = await conflicts.openConflicts();

    await conflicts.resolveWith(open!.id, { title: "remote" });

    const stored = await db.queryOne<{ title: string; read: boolean }>(
      "select title, read from public.projects where id = $1",
      [ROW],
    );
    assert.deepEqual({ ...stored }, { title: "Theirs", read: true });
    assert.deepEqual(await conflicts.openConflicts(), []);
    await db.close();
  });
});
