import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { localSqlDb, type LocalSqlDb } from "./local-sql";
import { ConflictStore } from "../domain/conflicts";
import { Outbox } from "../domain/outbox";

/**
 * The reader's half of a conflict.
 *
 * What they keep is a new edit on top of the server's row rather than a
 * rewind: it is written locally and queued against the server's version, so
 * the other device is told a decision was made instead of silently losing one.
 */

const ROW = "00000000-0000-4000-8000-0000000e0101";
const base = { id: ROW, title: "Draft", read: false };

/** A synced table to apply into: the device-only migrations bring no schema. */
async function store(): Promise<{ db: LocalSqlDb; conflicts: ConflictStore; outbox: Outbox }> {
  const db = await localSqlDb();
  await db.exec(`create table if not exists sync_tables (table_name text primary key)`);
  await db.exec(
    `create table if not exists public.projects (id uuid primary key, title text, read boolean)`,
  );
  await db.exec(`insert into sync_tables values ('projects') on conflict do nothing`);
  return { db, conflicts: new ConflictStore(db), outbox: new Outbox(db) };
}

async function openConflict(db: LocalSqlDb, remote: Record<string, unknown> | null) {
  await db.exec(
    `insert into sync_conflicts (table_name, row_id, base, local, remote, fields, server_version)
     values ('projects', $1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, 7)`,
    [
      ROW,
      JSON.stringify(base),
      JSON.stringify({ ...base, title: "Mine" }),
      remote === null ? null : JSON.stringify(remote),
      JSON.stringify([{ field: "title", base: base.title, local: "Mine", remote: "Theirs" }]),
    ],
  );
}

describe("resolving a conflict by hand", () => {
  it("writes the kept field locally and queues it against the server's version", async () => {
    const { db, conflicts, outbox } = await store();
    await openConflict(db, { ...base, title: "Theirs", read: true });

    const [open] = await conflicts.openConflicts();
    await conflicts.resolveWith(open!.id, { title: "local" });

    assert.equal((await conflicts.openConflicts()).length, 0);
    const row = await db.queryOne<{ title: string; read: boolean }>(
      "select title, read from public.projects where id = $1",
      [ROW],
    );
    // The field they kept, on top of the field they never disagreed with.
    assert.equal(row!.title, "Mine");
    assert.equal(row!.read, true);

    const [entry] = await outbox.pending();
    assert.equal(entry!.op, "update");
    assert.equal(entry!.baseVersion, 7);
    assert.equal((entry!.payload as { title: string }).title, "Mine");
    await db.close();
  });

  it("keeps the server's value for a field left alone", async () => {
    const { db, conflicts } = await store();
    await openConflict(db, { ...base, title: "Theirs", read: true });

    const [open] = await conflicts.openConflicts();
    await conflicts.resolveWith(open!.id, {});

    const row = await db.queryOne<{ title: string }>(
      "select title from public.projects where id = $1",
      [ROW],
    );
    assert.equal(row!.title, "Theirs");
    await db.close();
  });

  it("cannot settle a conflict whose other side has not arrived", async () => {
    const { db, conflicts } = await store();
    await openConflict(db, null);

    const [open] = await conflicts.openConflicts();
    await conflicts.resolveWith(open!.id, { title: "local" });

    // Still open: there is nothing yet to decide against.
    assert.equal((await conflicts.openConflicts()).length, 1);
    await db.close();
  });
});
