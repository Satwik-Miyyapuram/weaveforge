import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { testDb } from "../../../backend/test/pg-test-db";
import { sqlRunner } from "./local-sql";
import { Puller } from "../domain/puller";
import { Outbox } from "../domain/outbox";
import { ConflictStore, deletionFor } from "../domain/conflicts";
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

  it("merges an unsent local paper that others point at into the server's copy", async () => {
    // Its list items and relations waited on a parent the server refused (23503) forever.
    const db = await testDb();
    const user = await db.createUser();
    const sql = sqlRunner((q, p) => db.sql(q, p as unknown[]));
    const project = randomUUID();
    const local = randomUUID();
    const other = randomUUID();
    const server = randomUUID();
    const list = randomUUID();
    await db.sql("insert into projects (id, user_id, name) values ($1, $2, 'p')", [project, user]);
    await db.sql("insert into papers (id, user_id, project_id, title, authors, arxiv_id) values ($1, $2, $3, 'twin', '{}', '1910.10831'), ($4, $2, $3, 'other', '{}', '2203.02053')", [local, user, project, other]);
    await db.sql("insert into reading_lists (id, user_id, name) values ($1, $2, 'l')", [list, user]);
    const [item] = await db.sql<{ id: string }>("insert into reading_list_items (list_id, paper_id) values ($1, $2) returning id::text", [list, local]);
    const [rel] = await db.sql<{ id: string }>("insert into paper_relations (user_id, from_paper, to_paper, relation) values ($1, $2, $3, 'cites') returning id::text", [user, local, other]);
    const outbox = new Outbox(sql);
    for (const [table, rowId, payload] of [
      ["papers", local, {}],
      ["reading_list_items", item!.id, { id: item!.id, list_id: list, paper_id: local }],
      ["paper_relations", rel!.id, { id: rel!.id, from_paper: local, to_paper: other }],
    ] as const) {
      if ((await db.sql("select 1 from sync_outbox where row_id = $1", [rowId])).length === 0) {
        await outbox.append({ table, rowId, op: "insert", payload });
      }
    }
    const [twin] = await db.sql<{ r: Record<string, unknown> }>("select to_jsonb(p) as r from papers p where id = $1", [local]);
    const row = { ...twin!.r, id: server, server_seq: 11, row_version: 1 };

    await new Puller(sql, new SyncStateStore(sql), transport([[change({ table: "papers", row, serverSeq: 11 })]])).pull();

    assert.equal((await db.sql("select 1 from sync_pull_held where row_id = $1", [server])).length, 0);
    const ids = (await db.sql<{ id: string }>("select id::text from papers where project_id = $1 order by title", [project])).map((r) => r.id);
    assert.deepEqual(ids, [other, server]);
    assert.equal((await db.sql<{ p: string }>("select paper_id::text as p from reading_list_items where id = $1", [item!.id]))[0]?.p, server);
    assert.equal((await db.sql<{ p: string }>("select from_paper::text as p from paper_relations where id = $1", [rel!.id]))[0]?.p, server);
    const queued = await db.sql<{ table_name: string; payload: Record<string, unknown> }>(
      "select table_name, payload from sync_outbox where row_id in ($1, $2)", [item!.id, rel!.id]);
    assert.ok(queued.length > 0);
    for (const q of queued) assert.doesNotMatch(JSON.stringify(q.payload), new RegExp(local), q.table_name);
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

  const conflictOn = async (s: Awaited<ReturnType<typeof setup>>, id: string) =>
    (await s.conflicts.openConflicts()).filter((c) => c.rowId === id);

  it("asks the reader when a local delete meets a newer edit from elsewhere", async () => {
    const id = "00000000-0000-4000-8000-00000000f002";
    const s = await setup(id);
    await s.db.sql("delete from projects where id = $1", [id]);
    await s.db.sql("delete from sync_outbox where row_id = $1", [id]);
    await s.outbox.append({ table: "projects", rowId: id, op: "delete", baseVersion: 1 });

    await pull(s, change({ rowVersion: 4, serverSeq: 7002, row: { ...s.base, name: "Theirs", row_version: 4, server_seq: 7002 } }));

    const [open] = await conflictOn(s, id);
    assert.equal(open!.kind, "deleted_local");
    assert.equal(open!.serverVersion, 4);
    assert.equal((open!.remote as Record<string, unknown>).name, "Theirs");
    // Not sent until the reader decides; the row stays gone here.
    assert.deepEqual(await s.outbox.forRow("projects", id), []);
    assert.equal((await s.db.sql("select 1 from projects where id = $1", [id])).length, 0);
  });

  it("keeps owed edits when the row was deleted elsewhere, and asks the reader", async () => {
    const id = "00000000-0000-4000-8000-00000000f003";
    const s = await setup(id);
    await s.db.sql("update projects set name = 'Mine' where id = $1", [id]);
    await s.outbox.append({ table: "projects", rowId: id, op: "update", payload: { ...s.base, name: "Mine" }, baseVersion: 1 });

    await pull(s, change({ rowVersion: 2, serverSeq: 7003, deletedAt: "2026-01-01T00:00:00Z",
      row: { ...s.base, row_version: 2, server_seq: 7003, deleted_at: "2026-01-01T00:00:00Z" } }));

    const [row] = await s.db.sql<{ name: string }>("select name from projects where id = $1", [id]);
    assert.equal(row!.name, "Mine");
    const [open] = await conflictOn(s, id);
    assert.equal(open!.kind, "deleted_remote");
    assert.equal((open!.local as Record<string, unknown>).name, "Mine");
  });

  it("merges edits to different fields of both branches", async () => {
    const id = "00000000-0000-4000-8000-00000000f004";
    const s = await setup(id);
    await s.outbox.append({ table: "projects", rowId: id, op: "update", payload: { ...s.base, name: "Mine" }, basePayload: s.base, baseVersion: 1 });

    await pull(s, change({ rowVersion: 2, serverSeq: 7004, row: { ...s.base, color: "theirs", row_version: 2, server_seq: 7004 } }));

    const [row] = await s.db.sql<{ name: string; color: string }>("select name, color from projects where id = $1", [id]);
    assert.deepEqual({ ...row }, { name: "Mine", color: "theirs" });
    assert.deepEqual(await conflictOn(s, id), []);
    const [entry] = await s.outbox.forRow("projects", id);
    assert.equal(entry!.baseVersion, 2);
  });

  it("leaves a conflict open when both branches changed the same field", async () => {
    const id = "00000000-0000-4000-8000-00000000f005";
    const s = await setup(id);
    await s.outbox.append({ table: "projects", rowId: id, op: "update", payload: { ...s.base, name: "Mine" }, basePayload: s.base, baseVersion: 1 });

    await pull(s, change({ rowVersion: 2, serverSeq: 7005, row: { ...s.base, name: "Theirs", row_version: 2, server_seq: 7005 } }));

    const [open] = await conflictOn(s, id);
    assert.deepEqual(open!.fields.map((f) => f.field), ["name"]);
    assert.equal(open!.serverVersion, 2);
    assert.deepEqual(await s.outbox.forRow("projects", id), []);
  });
});

describe("a delete the reader settles", () => {
  async function setup(id: string) {
    const db = await testDb();
    const user = await db.createUser();
    const sql = sqlRunner((q, p) => db.sql(q, p as unknown[]));
    await db.sql("insert into projects (id, user_id, name) values ($1, $2, 'Draft')", [id, user]);
    await db.sql("delete from sync_outbox where row_id = $1", [id]);
    const base = { id, user_id: user, name: "Draft", color: null, created_at: "2026-01-01T00:00:00Z" };
    return { db, sql, user, base, state: new SyncStateStore(sql), outbox: new Outbox(sql), conflicts: new ConflictStore(sql) };
  }
  type S = Awaited<ReturnType<typeof setup>>;
  const pull = (s: S, c: RemoteChange) => new Puller(s.sql, s.state, transport([[c]]), s.conflicts).pull();
  const open = async (s: S, id: string) => (await s.conflicts.openConflicts()).filter((c) => c.rowId === id);
  const tombstone = (s: S, seq: number) =>
    change({ rowVersion: 2, serverSeq: seq, deletedAt: "2026-01-01T00:00:00Z", row: { ...s.base, row_version: 2, server_seq: seq, deleted_at: "2026-01-01T00:00:00Z" } });
  /** Deleted elsewhere while edited here. */
  async function deletedRemote(id: string, seq: number) {
    const s = await setup(id);
    await s.db.sql("update projects set name = 'Mine' where id = $1", [id]);
    await s.db.sql("delete from sync_outbox where row_id = $1", [id]);
    await s.outbox.append({ table: "projects", rowId: id, op: "update", payload: { ...s.base, name: "Mine" }, baseVersion: 1 });
    await pull(s, tombstone(s, seq));
    return s;
  }
  /** Deleted here while edited elsewhere. */
  async function deletedLocal(id: string, seq: number) {
    const s = await setup(id);
    await s.db.sql("delete from projects where id = $1", [id]);
    await s.db.sql("delete from sync_outbox where row_id = $1", [id]);
    await s.outbox.append({ table: "projects", rowId: id, op: "delete", baseVersion: 1 });
    await pull(s, change({ rowVersion: 4, serverSeq: seq, row: { ...s.base, name: "Theirs", row_version: 4, server_seq: seq } }));
    return s;
  }

  it("keeps mine: the row stays and goes up whole as an insert", async () => {
    const id = "00000000-0000-4000-8000-00000000a101";
    const s = await deletedRemote(id, 8001);
    const [c] = await open(s, id);

    await s.conflicts.resolveDeletion(c!.id, "keep");

    assert.equal((await s.db.sql<{ name: string }>("select name from projects where id = $1", [id]))[0]?.name, "Mine");
    const ops = await s.outbox.forRow("projects", id);
    assert.deepEqual(ops.map((o) => o.op), ["insert"]);
    assert.equal(ops[0]!.payload.name, "Mine");
    assert.deepEqual(await open(s, id), []);
  });

  it("accepts the delete elsewhere: the row and its children go, nothing is queued", async () => {
    const id = "00000000-0000-4000-8000-00000000a102";
    const s = await deletedRemote(id, 8002);
    const paper = randomUUID();
    await s.db.sql("insert into papers (id, user_id, project_id, title, authors) values ($1, $2, $3, 'child', '{}')", [paper, s.user, id]);
    await s.db.sql("delete from sync_outbox where row_id = $1", [paper]);
    await s.outbox.append({ table: "papers", rowId: paper, op: "update", payload: { id: paper, title: "child" }, baseVersion: 1 });
    const [c] = await open(s, id);

    await s.conflicts.resolveDeletion(c!.id, "delete");

    assert.equal((await s.db.sql("select 1 from projects where id = $1", [id])).length, 0);
    assert.equal((await s.db.sql("select 1 from papers where id = $1", [paper])).length, 0);
    assert.equal((await s.db.sql("select 1 from sync_outbox where row_id in ($1, $2)", [id, paper])).length, 0);
    assert.deepEqual(await open(s, id), []);
  });

  it("keeps my delete: sent against the version the server holds", async () => {
    const id = "00000000-0000-4000-8000-00000000a103";
    const s = await deletedLocal(id, 8003);
    const [c] = await open(s, id);

    await s.conflicts.resolveDeletion(c!.id, "delete");

    const ops = await s.outbox.forRow("projects", id);
    assert.deepEqual(ops.map((o) => [o.op, o.baseVersion]), [["delete", 4]]);
    assert.equal((await s.db.sql("select 1 from projects where id = $1", [id])).length, 0);
    assert.deepEqual(await open(s, id), []);
  });

  it("restores the cloud copy: the row comes back as the server has it, nothing queued", async () => {
    const id = "00000000-0000-4000-8000-00000000a104";
    const s = await deletedLocal(id, 8004);
    const [c] = await open(s, id);

    await s.conflicts.resolveDeletion(c!.id, "keep");

    assert.equal((await s.db.sql<{ name: string }>("select name from projects where id = $1", [id]))[0]?.name, "Theirs");
    assert.deepEqual(await s.outbox.forRow("projects", id), []);
    assert.deepEqual(await open(s, id), []);
  });

  it("keeps a later cloud edit as the copy to restore while the reader decides", async () => {
    const id = "00000000-0000-4000-8000-00000000a105";
    const s = await deletedLocal(id, 8005);

    await pull(s, change({ rowVersion: 5, serverSeq: 8006, row: { ...s.base, name: "Theirs again", row_version: 5, server_seq: 8006 } }));

    const [c] = await open(s, id);
    assert.equal(c!.kind, "deleted_local");
    assert.equal(c!.serverVersion, 5);
    assert.equal((c!.remote as Record<string, unknown>).name, "Theirs again");
    assert.equal((await s.db.sql("select 1 from projects where id = $1", [id])).length, 0);
  });

  it("asks before removing a parent that an owed child edit points at", async () => {
    const id = "00000000-0000-4000-8000-00000000a106";
    const s = await setup(id);
    const paper = randomUUID();
    await s.db.sql("insert into papers (id, user_id, project_id, title, authors) values ($1, $2, $3, 'new', '{}')", [paper, s.user, id]);
    await s.db.sql("delete from sync_outbox where row_id = $1", [paper]);
    await s.outbox.append({ table: "papers", rowId: paper, op: "insert", payload: { id: paper, project_id: id, title: "new" } });

    await pull(s, tombstone(s, 8007));

    assert.equal((await s.db.sql("select 1 from papers where id = $1", [paper])).length, 1);
    const [c] = await open(s, id);
    assert.equal(c!.kind, "deleted_remote");
    assert.equal((await s.outbox.forRow("papers", paper)).length, 1);
  });

  it("asks nothing when both sides deleted the row", async () => {
    const id = "00000000-0000-4000-8000-00000000a107";
    const s = await setup(id);
    await s.db.sql("delete from projects where id = $1", [id]);
    await s.db.sql("delete from sync_outbox where row_id = $1", [id]);
    await s.outbox.append({ table: "projects", rowId: id, op: "delete", baseVersion: 1 });

    await pull(s, tombstone(s, 8008));

    assert.deepEqual(await open(s, id), []);
    assert.deepEqual(await s.outbox.forRow("projects", id), []);
  });

  it("removes a row deleted elsewhere when nothing here is owed for it", async () => {
    const id = "00000000-0000-4000-8000-00000000a108";
    const s = await setup(id);

    await pull(s, tombstone(s, 8009));

    assert.equal((await s.db.sql("select 1 from projects where id = $1", [id])).length, 0);
    assert.deepEqual(await open(s, id), []);
  });

  it("settles both kinds from one bulk pick: mine keeps what this device did", async () => {
    const remoteId = "00000000-0000-4000-8000-00000000a109";
    const localId = "00000000-0000-4000-8000-00000000a110";
    const r = await deletedRemote(remoteId, 8010);
    const l = await deletedLocal(localId, 8011);

    for (const c of [...(await open(r, remoteId)), ...(await open(l, localId))]) {
      assert.notEqual(c.kind, "edit");
      await r.conflicts.resolveDeletion(c.id, deletionFor(c.kind as "deleted_remote" | "deleted_local", "local"));
    }

    assert.equal((await r.db.sql<{ name: string }>("select name from projects where id = $1", [remoteId]))[0]?.name, "Mine");
    assert.deepEqual((await r.outbox.forRow("projects", remoteId)).map((o) => o.op), ["insert"]);
    assert.equal((await l.db.sql("select 1 from projects where id = $1", [localId])).length, 0);
    assert.deepEqual((await l.outbox.forRow("projects", localId)).map((o) => o.op), ["delete"]);
  });

  it("maps a bulk pick to each delete kind", () => {
    assert.equal(deletionFor("deleted_remote", "local"), "keep");
    assert.equal(deletionFor("deleted_remote", "remote"), "delete");
    assert.equal(deletionFor("deleted_local", "local"), "delete");
    assert.equal(deletionFor("deleted_local", "remote"), "keep");
  });
});
