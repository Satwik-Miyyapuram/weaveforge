import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { localSqlDb } from "./local-sql";
import { ConflictStore } from "../domain/conflicts";
import { Outbox } from "../domain/outbox";

const ROW = "00000000-0000-4000-8000-0000000e0001";

async function store() {
  const db = await localSqlDb();
  return { db, outbox: new Outbox(db), conflicts: new ConflictStore(db) };
}

const base = { id: ROW, title: "Draft", read: false };

describe("conflicts", () => {
  it("opens with the two sides the pump knows, and waits for the third", async () => {
    const { db, outbox, conflicts } = await store();
    const entry = await outbox.append({
      table: "projects",
      rowId: ROW,
      op: "update",
      payload: { ...base, title: "Mine" },
      basePayload: base,
      baseVersion: 2,
    });

    await conflicts.open(entry, 5);

    const [open] = await conflicts.openConflicts();
    assert.equal(open!.remote, null);
    assert.deepEqual(open!.fields, []);
    assert.equal(open!.serverVersion, 5);
    await db.close();
  });

  it("resolves itself when the two sides touched different fields", async () => {
    const { db, outbox, conflicts } = await store();
    const entry = await outbox.append({
      table: "projects",
      rowId: ROW,
      op: "update",
      payload: { ...base, title: "Mine" },
      basePayload: base,
      baseVersion: 2,
    });
    await conflicts.open(entry, 5);

    const merged = await conflicts.settle("projects", ROW, { ...base, read: true });

    assert.deepEqual(merged, { id: ROW, title: "Mine", read: true });
    assert.deepEqual(await conflicts.openConflicts(), []);
    await db.close();
  });

  it("stays open, with the colliding fields, when the two sides disagree", async () => {
    const { db, outbox, conflicts } = await store();
    const entry = await outbox.append({
      table: "projects",
      rowId: ROW,
      op: "update",
      payload: { ...base, title: "Mine" },
      basePayload: base,
      baseVersion: 2,
    });
    await conflicts.open(entry, 5);

    const merged = await conflicts.settle("projects", ROW, { ...base, title: "Theirs" });

    assert.equal(merged, null);
    const [open] = await conflicts.openConflicts();
    assert.deepEqual(open!.fields, [
      { field: "title", base: "Draft", local: "Mine", remote: "Theirs" },
    ]);
    await db.close();
  });

  it("keeps one open conflict per row, not one per attempt", async () => {
    const { db, outbox, conflicts } = await store();
    const entry = await outbox.append({
      table: "projects",
      rowId: ROW,
      op: "update",
      payload: { ...base, title: "Mine" },
      basePayload: base,
      baseVersion: 2,
    });

    await conflicts.open(entry, 5);
    await conflicts.open(entry, 6);

    assert.equal((await conflicts.openConflicts()).length, 1);
    await db.close();
  });

  it("records nothing for an insert, which has no base to merge against", async () => {
    const { db, outbox, conflicts } = await store();
    const entry = await outbox.append({
      table: "projects",
      rowId: ROW,
      op: "insert",
      payload: base,
    });

    await conflicts.open(entry, 1);

    assert.deepEqual(await conflicts.openConflicts(), []);
    await db.close();
  });

  it("a resolved conflict leaves the row free to conflict again", async () => {
    const { db, outbox, conflicts } = await store();
    const entry = await outbox.append({
      table: "projects",
      rowId: ROW,
      op: "update",
      payload: { ...base, title: "Mine" },
      basePayload: base,
      baseVersion: 2,
    });
    await conflicts.open(entry, 5);
    const [first] = await conflicts.openConflicts();
    await conflicts.resolve(first!.id);

    await conflicts.open(entry, 7);

    const open = await conflicts.openConflicts();
    assert.equal(open.length, 1);
    assert.equal(open[0]!.serverVersion, 7);
    await db.close();
  });
});
