import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { testDb } from "../../../backend/test/pg-test-db";
import { sqlRunner } from "./local-sql";
import { Puller } from "../domain/puller";
import { Outbox } from "../domain/outbox";
import { ConflictStore } from "../domain/conflicts";
import { SyncStateStore } from "../domain/sync-state";
import type { RemoteChange, SyncTransport } from "../domain/sync-ports";

/**
 * The puller against the real schema.
 *
 * A fake transport, because what is under test is what happens to the local
 * database when the server says a row changed — not how the answer travelled.
 */
function transport(pages: RemoteChange[][]): SyncTransport {
  return {
    send: async () => ({ status: "accepted" }),
    changesSince: async () => pages.shift() ?? [],
  };
}

/** The feed sends whole rows (`to_jsonb(r)`), so the fakes do too. */
function change(over: Partial<RemoteChange> & { row: Record<string, unknown> }): RemoteChange {
  return {
    table: "projects",
    rowId: String(over.row.id),
    serverSeq: 1,
    deletedAt: null,
    rowVersion: 1,
    ...over,
  };
}

describe("the puller", () => {
  it("writes a pulled row with the server's own watermark and version", async () => {
    const db = await testDb();
    const user = await db.createUser();
    const sql = sqlRunner((q, p) => db.sql(q, p as unknown[]));
    const state = new SyncStateStore(sql);
    const id = "00000000-0000-4000-8000-00000000c001";
    const row = { id, user_id: user, name: "from the server", server_seq: 4100, row_version: 6, created_at: "2026-01-01T00:00:00Z" };

    const result = await new Puller(sql, state, transport([[change({ row, serverSeq: 4100 })]])).pull();

    assert.equal(result.applied, 1);
    const [stored] = await db.sql<{ name: string; server_seq: string; row_version: number }>(
      "select name, server_seq, row_version from projects where id = $1",
      [id],
    );
    assert.equal(stored!.name, "from the server");
    // Not re-stamped: a device that renumbered a pulled row would send it back
    // as its own work and lose track of what it had read.
    assert.equal(Number(stored!.server_seq), 4100);
    assert.equal(stored!.row_version, 6);
  });

  it("advances the watermark to the highest sequence it applied", async () => {
    const db = await testDb();
    const user = await db.createUser();
    const sql = sqlRunner((q, p) => db.sql(q, p as unknown[]));
    const state = new SyncStateStore(sql);
    await db.sql("update sync_state set watermark = 0");
    const rows = [1, 2, 3].map((n) =>
      change({
        serverSeq: 5000 + n,
        row: {
          id: `00000000-0000-4000-8000-00000000d00${n}`,
          user_id: user,
          name: `p${n}`,
          server_seq: 5000 + n,
          row_version: 1,
          created_at: "2026-01-01T00:00:00Z",
        },
      }),
    );

    const result = await new Puller(sql, state, transport([rows])).pull();
    assert.equal(result.watermark, 5003);
    assert.equal((await state.read()).watermark, 5003);
  });

  it("removes the local row when a tombstone arrives, so no screen shows it", async () => {
    const db = await testDb();
    const user = await db.createUser();
    const sql = sqlRunner((q, p) => db.sql(q, p as unknown[]));
    const state = new SyncStateStore(sql);
    const id = "00000000-0000-4000-8000-00000000e001";
    await db.sql("insert into projects (id, user_id, name) values ($1, $2, $3)", [id, user, "here"]);

    await new Puller(
      sql,
      state,
      transport([
        [
          change({
            serverSeq: 6001,
            deletedAt: "2026-01-01T00:00:00Z",
            row: {
              id,
              user_id: user,
              name: "here",
              server_seq: 6001,
              row_version: 2,
              created_at: "2026-01-01T00:00:00Z",
              deleted_at: "2026-01-01T00:00:00Z",
            },
          }),
        ],
      ]),
    ).pull();

    const stored = await db.sql("select 1 from projects where id = $1", [id]);
    assert.equal(stored.length, 0);
  });

  it("refuses to write a table that is not part of sync", async () => {
    const db = await testDb();
    const sql = sqlRunner((q, p) => db.sql(q, p as unknown[]));
    const state = new SyncStateStore(sql);
    await assert.rejects(
      new Puller(sql, state, transport([[change({ table: "api_tokens", row: { id: "x" } })]])).pull(),
      /not a synced table/,
    );
  });
});

describe("the puller with work still owed", () => {
  async function setup(id: string) {
    const db = await testDb();
    const user = await db.createUser();
    const sql = sqlRunner((q, p) => db.sql(q, p as unknown[]));
    const state = new SyncStateStore(sql);
    await db.sql("insert into projects (id, user_id, name) values ($1, $2, $3)", [id, user, "Draft"]);
    const base = { id, user_id: user, name: "Draft", color: null, created_at: "2026-01-01T00:00:00Z" };
    return { db, sql, state, base, outbox: new Outbox(sql), conflicts: new ConflictStore(sql) };
  }

  const pull = (s: Awaited<ReturnType<typeof setup>>, c: RemoteChange) =>
    new Puller(s.sql, s.state, transport([[c]]), s.conflicts).pull();

  it("skips its own accepted write coming back", async () => {
    const id = "00000000-0000-4000-8000-00000000f001";
    const s = await setup(id);
    await s.outbox.append({ table: "projects", rowId: id, op: "update", payload: { ...s.base, name: "Newer" }, baseVersion: 3 });
    await s.db.sql("update projects set name = 'Newer' where id = $1", [id]);

    await pull(s, change({ rowVersion: 3, serverSeq: 7001, row: { ...s.base, name: "Mine", row_version: 3, server_seq: 7001 } }));

    const [row] = await s.db.sql<{ name: string }>("select name from projects where id = $1", [id]);
    assert.equal(row!.name, "Newer");
    assert.equal((await s.outbox.forRow("projects", id)).length, 1);
  });

  it("keeps a local delete, re-aimed at the server's version", async () => {
    const id = "00000000-0000-4000-8000-00000000f002";
    const s = await setup(id);
    await s.outbox.append({ table: "projects", rowId: id, op: "delete", baseVersion: 1 });

    await pull(s, change({ rowVersion: 4, serverSeq: 7002, row: { ...s.base, name: "Theirs", row_version: 4, server_seq: 7002 } }));

    const [entry] = await s.outbox.forRow("projects", id);
    assert.equal(entry!.op, "delete");
    assert.equal(entry!.baseVersion, 4);
  });

  it("drops owed edits when the row was deleted elsewhere", async () => {
    const id = "00000000-0000-4000-8000-00000000f003";
    const s = await setup(id);
    await s.outbox.append({ table: "projects", rowId: id, op: "update", payload: { ...s.base, name: "Mine" }, baseVersion: 1 });

    await pull(s, change({ rowVersion: 2, serverSeq: 7003, deletedAt: "2026-01-01T00:00:00Z",
      row: { ...s.base, row_version: 2, server_seq: 7003, deleted_at: "2026-01-01T00:00:00Z" } }));

    assert.deepEqual(await s.outbox.forRow("projects", id), []);
    assert.equal((await s.db.sql("select 1 from projects where id = $1", [id])).length, 0);
  });

  it("merges edits to different fields of both branches", async () => {
    const id = "00000000-0000-4000-8000-00000000f004";
    const s = await setup(id);
    await s.outbox.append({ table: "projects", rowId: id, op: "update", payload: { ...s.base, name: "Mine" }, basePayload: s.base, baseVersion: 1 });

    await pull(s, change({ rowVersion: 2, serverSeq: 7004, row: { ...s.base, color: "theirs", row_version: 2, server_seq: 7004 } }));

    const [row] = await s.db.sql<{ name: string; color: string }>("select name, color from projects where id = $1", [id]);
    assert.deepEqual({ ...row }, { name: "Mine", color: "theirs" });
    assert.deepEqual(await s.conflicts.openConflicts(), []);
    const [entry] = await s.outbox.forRow("projects", id);
    assert.equal(entry!.baseVersion, 2);
  });

  it("leaves a conflict open when both branches changed the same field", async () => {
    const id = "00000000-0000-4000-8000-00000000f005";
    const s = await setup(id);
    await s.outbox.append({ table: "projects", rowId: id, op: "update", payload: { ...s.base, name: "Mine" }, basePayload: s.base, baseVersion: 1 });

    await pull(s, change({ rowVersion: 2, serverSeq: 7005, row: { ...s.base, name: "Theirs", row_version: 2, server_seq: 7005 } }));

    const [open] = await s.conflicts.openConflicts();
    assert.deepEqual(open!.fields.map((f) => f.field), ["name"]);
    assert.equal(open!.serverVersion, 2);
    assert.deepEqual(await s.outbox.forRow("projects", id), []);
  });
});
