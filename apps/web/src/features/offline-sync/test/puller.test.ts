import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

/** The database is shared by the file; held rows and the watermark are not. */
async function fresh(db: Awaited<ReturnType<typeof testDb>>) {
  await db.sql("delete from sync_pull_held");
  await db.sql("update sync_state set watermark = 0");
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

  it("holds a change for a table it does not know and still moves on", async () => {
    // A table the server adds later must not stall an older app forever.
    const db = await testDb();
    await fresh(db);
    const sql = sqlRunner((q, p) => db.sql(q, p as unknown[]));
    const state = new SyncStateStore(sql);
    const result = await new Puller(sql, state, transport([[change({ table: "api_tokens", row: { id: "x" }, serverSeq: 7 })]])).pull();
    assert.equal(result.applied, 0);
    assert.equal(result.held, 1);
    assert.equal((await state.read()).watermark, 7);
  });
});

describe("the puller meeting a row that will not apply", () => {
  async function setup() {
    const db = await testDb();
    await fresh(db);
    const user = await db.createUser();
    const sql = sqlRunner((q, p) => db.sql(q, p as unknown[]));
    const project = randomUUID();
    await db.sql("insert into projects (id, user_id, name) values ($1, $2, 'p')", [project, user]);
    return { db, user, sql, project, state: new SyncStateStore(sql) };
  }
  const page = (project: string, user: string, id: string, title: string, seq: number) =>
    change({ table: "vault_pages", serverSeq: seq, row: { id, user_id: user, project_id: project, title, body: "", sort_order: 0, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", server_seq: seq, row_version: 2 } });

  it("parks it, applies the rest, and advances the watermark", async () => {
    const { db, user, sql, project, state } = await setup();
    const bad = change({ table: "vault_pages", serverSeq: 5, row: { id: randomUUID(), user_id: user, project_id: project, title: null } });
    const good = page(project, user, randomUUID(), "fine", 6);

    const result = await new Puller(sql, state, transport([[bad, good]])).pull();

    assert.equal(result.applied, 1);
    assert.equal(result.held, 1);
    assert.equal((await state.read()).watermark, 6);
    assert.equal((await db.sql("select 1 from vault_pages where title = 'fine'")).length, 1);
  });

  it("retries a held change and lets it go once it lands", async () => {
    const { db, user, sql, project, state } = await setup();
    const id = randomUUID();
    const blocker = randomUUID();
    await db.sql("insert into vault_pages (id, user_id, project_id, title) values ($1, $2, $3, 'Taken')", [blocker, user, project]);
    await db.sql("delete from sync_outbox");

    const first = await new Puller(sql, state, transport([[page(project, user, id, "taken", 3)]])).pull();
    assert.equal(first.held, 1);

    await db.sql("update vault_pages set title = 'Other' where id = $1", [blocker]);
    const second = await new Puller(sql, state, transport([[]])).pull();
    assert.equal(second.held, 0);
    assert.equal(second.applied, 1);
    assert.equal((await db.sql("select 1 from vault_pages where id = $1", [id])).length, 1);
  });

  it("lands two notes that swapped titles on the server", async () => {
    const { db, user, sql, project, state } = await setup();
    const a = randomUUID();
    const b = randomUUID();
    await db.sql("insert into vault_pages (id, user_id, project_id, title) values ($1, $2, $3, 'x'), ($4, $2, $3, 'y')", [a, user, project, b]);
    await db.sql("delete from sync_outbox");

    const result = await new Puller(sql, state, transport([[page(project, user, b, "x", 2), page(project, user, a, "y", 3)]])).pull();

    assert.equal(result.held, 0);
    const rows = await db.sql<{ id: string; title: string }>("select id::text, title from vault_pages where project_id = $1 order by title", [project]);
    assert.deepEqual(rows.map((r) => r.id), [b, a]);
  });

  it("never takes a local note for a twin by its project alone", async () => {
    // The title index is on lower(title); matching its plain columns only would
    // pick any unsent note in the project.
    const { db, user, sql, project, state } = await setup();
    const local = randomUUID();
    await db.sql("insert into vault_pages (id, user_id, project_id, title) values ($1, $2, $3, 'Mine')", [local, user, project]);
    const other = randomUUID();
    await db.sql("insert into vault_pages (id, user_id, project_id, title) values ($1, $2, $3, 'Clash')", [other, user, project]);

    await new Puller(sql, state, transport([[page(project, user, randomUUID(), "clash", 4)]])).pull();

    assert.equal((await db.sql("select 1 from vault_pages where id = $1", [local])).length, 1);
    assert.equal((await db.sql("select 1 from vault_pages where id = $1", [other])).length, 1);
  });
});

describe("the puller meeting a local twin", () => {
  it("drops an unsent local paper that clashes with the server's copy, so the pull goes on", async () => {
    const db = await testDb();
    const user = await db.createUser();
    const sql = sqlRunner((q, p) => db.sql(q, p as unknown[]));
    const project = randomUUID();
    const local = randomUUID();
    const server = randomUUID();
    await db.sql("insert into projects (id, user_id, name) values ($1, $2, 'p')", [project, user]);
    await db.sql("insert into papers (id, user_id, project_id, title, authors, arxiv_id) values ($1, $2, $3, 'twin', '{}', '2002.02886')", [local, user, project]);
    if ((await db.sql("select 1 from sync_outbox where row_id = $1 and op = 'insert'", [local])).length === 0) {
      await new Outbox(sql).append({ table: "papers", rowId: local, op: "insert", payload: {} });
    }
    // The feed sends whole rows; the server's copy differs only by id.
    const [twin] = await db.sql<{ r: Record<string, unknown> }>("select to_jsonb(p) as r from papers p where id = $1", [local]);
    const row = { ...twin!.r, id: server, server_seq: 9, row_version: 1 };

    const result = await new Puller(sql, new SyncStateStore(sql), transport([[change({ table: "papers", row, serverSeq: 9 })]])).pull();

    assert.equal(result.applied, 1);
    const ids = (await db.sql<{ id: string }>("select id from papers where project_id = $1", [project])).map((r) => r.id);
    assert.deepEqual(ids, [server]);
    assert.equal((await db.sql("select 1 from sync_outbox where row_id = $1", [local])).length, 0);
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
