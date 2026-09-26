import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { testDb } from "./pg-test-db";

/**
 * The change feed, against the real migrations.
 *
 * What is worth proving is not that the SQL parses — applying it already does
 * that — but that the three properties the sync design depends on hold: the
 * watermark moves on every write, a delete stays visible as a tombstone, and
 * the feed shows a caller only what they could have selected themselves.
 */
describe("the sync change feed", () => {
  it("registers only tables that exist and carry a uuid id", async () => {
    const db = await testDb();
    const rows = await db.sql<{ table_name: string }>(
      `select t.table_name from sync_tables t
        where to_regclass(format('public.%I', t.table_name)) is null`,
    );
    assert.deepEqual(rows, []);
  });

  it("stamps a watermark that moves on insert and again on update", async () => {
    const db = await testDb();
    const user = await db.createUser();
    const as = db.as(user);
    const [project] = await as.sql<{ id: string; server_seq: string }>(
      "insert into projects (user_id, name) values ($1, $2) returning id, server_seq",
      [user, "first"],
    );
    const [updated] = await as.sql<{ server_seq: string; row_version: number }>(
      "update projects set name = $1 where id = $2 returning server_seq, row_version",
      ["second", project!.id],
    );
    assert.ok(Number(updated!.server_seq) > Number(project!.server_seq));
    assert.equal(updated!.row_version, 2);
  });

  it("returns a deleted row as a tombstone rather than dropping it", async () => {
    const db = await testDb();
    const user = await db.createUser();
    const as = db.as(user);
    const [project] = await as.sql<{ id: string }>(
      "insert into projects (user_id, name) values ($1, $2) returning id",
      [user, "to delete"],
    );
    await as.sql("update projects set deleted_at = now() where id = $1", [project!.id]);
    const rows = await as.sql<{ row_id: string; deleted_at: string | null }>(
      "select row_id, deleted_at from sync_changes(0, 500) where row_id = $1",
      [project!.id],
    );
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0]!.deleted_at, null);
  });

  it("sends a real delete as a tombstone the owner can read", async () => {
    const db = await testDb();
    const user = await db.createUser();
    const other = await db.createUser();
    const as = db.as(user);
    const [project] = await as.sql<{ id: string; server_seq: string }>(
      "insert into projects (user_id, name) values ($1, $2) returning id, server_seq",
      [user, "gone soon"],
    );
    await as.sql("delete from projects where id = $1", [project!.id]);
    const rows = await as.sql<{ server_seq: string; deleted_at: string | null; row_data: { id: string } }>(
      "select server_seq, deleted_at, row_data from sync_changes($1, 500) where row_id = $2",
      [project!.server_seq, project!.id],
    );
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0]!.deleted_at, null);
    assert.equal(rows[0]!.row_data.id, project!.id);
    const seen = await db.as(other).sql("select 1 from sync_changes(0, 2000) where row_id = $1", [project!.id]);
    assert.equal(seen.length, 0);
  });

  it("forgets the tombstone when the row comes back", async () => {
    const db = await testDb();
    const user = await db.createUser();
    const as = db.as(user);
    const [project] = await as.sql<{ id: string }>(
      "insert into projects (user_id, name) values ($1, $2) returning id",
      [user, "back again"],
    );
    await as.sql("delete from projects where id = $1", [project!.id]);
    await as.sql("insert into projects (id, user_id, name) values ($1, $2, $3)", [project!.id, user, "back again"]);
    const rows = await as.sql<{ deleted_at: string | null }>(
      "select deleted_at from sync_changes(0, 2000) where row_id = $1",
      [project!.id],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.deleted_at, null);
  });

  it("shows a caller nothing that belongs to somebody else", async () => {
    const db = await testDb();
    const mine = await db.createUser();
    const theirs = await db.createUser();
    await db.as(theirs).sql("insert into projects (user_id, name) values ($1, $2)", [
      theirs,
      "not yours",
    ]);
    await db.as(mine).sql("insert into projects (user_id, name) values ($1, $2)", [mine, "mine"]);
    const rows = await db.as(mine).sql<{ row_data: { name: string } }>(
      "select row_data from sync_changes(0, 2000) where table_name = 'projects'",
    );
    const names = rows.map((r) => r.row_data.name);
    // Both halves matter: an empty feed would pass the first assertion while
    // proving nothing about policies.
    assert.ok(names.includes("mine"));
    assert.ok(!names.includes("not yours"));
  });

  it("answers from a watermark, so a caught-up client gets nothing", async () => {
    const db = await testDb();
    const user = await db.createUser();
    const as = db.as(user);
    await as.sql("insert into projects (user_id, name) values ($1, $2)", [user, "one"]);
    const highest = await as.sql<{ high: string }>(
      "select coalesce(max(server_seq), 0) as high from projects",
    );
    const rows = await as.sql("select 1 from sync_changes($1, 500)", [highest[0]!.high]);
    assert.deepEqual(rows, []);
  });

  it("pages by server_seq across tables, so a full page from one table hides nothing", async () => {
    const db = await testDb();
    const user = await db.createUser();
    const as = db.as(user);
    // A paper (alphabetically first) written *after* a project: per-table
    // paging would send the paper, advance the watermark past the project,
    // and never send the project.
    const [project] = await as.sql<{ id: string }>(
      "insert into projects (user_id, name) values ($1, $2) returning id",
      [user, "older"],
    );
    await as.sql("insert into papers (user_id, title) values ($1, $2)", [user, "newer"]);
    const page = await as.sql<{ table_name: string; row_id: string; server_seq: string }>(
      "select table_name, row_id, server_seq from sync_changes(0, 1)",
    );
    assert.equal(page.length, 1);
    assert.equal(page[0]!.row_id, project!.id);
    const next = await as.sql<{ table_name: string }>(
      "select table_name from sync_changes($1, 1)",
      [page[0]!.server_seq],
    );
    assert.equal(next[0]!.table_name, "papers");
  });
});
