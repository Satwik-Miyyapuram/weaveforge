import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { LOCAL_USER_ID } from "@weaveforge/core";
import { testDb } from "../../../backend/test/pg-test-db";
import { sqlRunner } from "./local-sql";
import { Adoption } from "../domain/adoption";

// One database per file, so every id is new.
let nextId = 100;
function id(): string {
  nextId += 1;
  return `00000000-0000-4000-9000-${String(nextId).padStart(12, "0")}`;
}

interface Op {
  table_name: string;
  row_id: string;
  op: string;
  payload: Record<string, unknown>;
  base_version: number | null;
}

/** A device that belongs to `account`, with an empty queue. */
async function adoptedDevice() {
  const db = await testDb();
  await db.sql("delete from sync_outbox");
  const account = await db.createUser();
  await db.sql("update sync_state set account_id = $1, watermark = 0", [account]);
  const project = id();
  await db.as(account).sql("insert into projects (id, user_id, name) values ($1, $2, 'Thesis')", [
    project,
    account,
  ]);
  await db.sql("delete from sync_outbox");
  const ops = (rowId: string) =>
    db.sql<Op>("select table_name, row_id, op, payload, base_version from sync_outbox where row_id = $1 order by seq", [
      rowId,
    ]);
  return { db, account, project, ops };
}

describe("local-first: local writes become ops", () => {
  it("records nothing on a device that has no account", async () => {
    const db = await testDb();
    await db.sql("update sync_state set account_id = null");
    await db.sql("insert into auth.users (id, email) values ($1, 'local@device') on conflict do nothing", [
      LOCAL_USER_ID,
    ]);
    const project = id();
    await db.sql("insert into projects (id, user_id, name) values ($1, $2, 'Offline')", [project, LOCAL_USER_ID]);
    const rows = await db.sql("select 1 from sync_outbox where row_id = $1", [project]);
    assert.equal(rows.length, 0);
  });

  it("queues an insert, as the signed-in user, without generated columns", async () => {
    const { db, account, project, ops } = await adoptedDevice();
    const page = id();
    await db.as(account).sql(
      "insert into vault_pages (id, user_id, project_id, title, body) values ($1, $2, $3, 'Chapter 3', 'Draft body')",
      [page, account, project],
    );
    const [op] = await ops(page);
    assert.equal(op!.op, "insert");
    assert.equal(op!.payload.title, "Chapter 3");
    assert.equal("body_preview" in op!.payload, false);
  });

  it("folds edits made before the next push into the waiting op", async () => {
    const { db, account, project, ops } = await adoptedDevice();
    await db.as(account).sql("update projects set name = 'Thesis v2' where id = $1", [project]);
    const [first] = await ops(project);
    await db.as(account).sql("update projects set name = 'Thesis v3' where id = $1", [project]);
    const all = await ops(project);
    assert.equal(all.length, 1);
    assert.equal(all[0]!.op, "update");
    assert.equal(all[0]!.payload.name, "Thesis v3");
    assert.equal(all[0]!.base_version, first!.base_version);
  });

  it("drops a row that was created and deleted between two pushes", async () => {
    const { db, account, project, ops } = await adoptedDevice();
    const entry = id();
    await db.as(account).sql(
      "insert into log_entries (id, user_id, project_id, body) values ($1, $2, $3, 'Scratch')",
      [entry, account, project],
    );
    assert.equal((await ops(entry)).length, 1);
    await db.as(account).sql("delete from log_entries where id = $1", [entry]);
    assert.equal((await ops(entry)).length, 0);
  });

  it("queues a delete of a row the server already has", async () => {
    const { db, account, project, ops } = await adoptedDevice();
    await db.as(account).sql("delete from projects where id = $1", [project]);
    const [op] = await ops(project);
    assert.equal(op!.op, "delete");
  });

  it("sends a re-tag (delete, then the same link again) as one update", async () => {
    const { db, account, project, ops } = await adoptedDevice();
    const as = db.as(account);
    const [paper] = await as.sql<{ id: string }>(
      "insert into papers (user_id, project_id, title) values ($1, $2, 'Tagged') returning id",
      [account, project],
    );
    const [tag] = await as.sql<{ id: string }>(
      "insert into tags (user_id, project_id, name) values ($1, $2, 'methods') returning id",
      [account, project],
    );
    const [link] = await as.sql<{ id: string }>(
      "insert into paper_tags (paper_id, tag_id, source) values ($1, $2, 'note') returning id",
      [paper!.id, tag!.id],
    );
    await db.sql("delete from sync_outbox");
    await as.sql("delete from paper_tags where paper_id = $1", [paper!.id]);
    await as.sql("insert into paper_tags (paper_id, tag_id, source) values ($1, $2, 'note')", [paper!.id, tag!.id]);
    const all = await ops(link!.id);
    assert.equal(all.length, 1);
    assert.equal(all[0]!.op, "update");
    assert.equal(all[0]!.payload.tag_id, tag!.id);
    assert.equal("id" in all[0]!.payload, false);
  });
});

describe("local-first: pulled rows", () => {
  it("applies a row with a generated column and records no op for it", async () => {
    const { db, account, project, ops } = await adoptedDevice();
    const page = id();
    const row = {
      id: page,
      user_id: account,
      project_id: project,
      title: "From the server",
      body: "Written elsewhere",
      body_preview: "Written elsewhere",
      sort_order: 0,
      created_at: "2026-09-01T10:00:00Z",
      updated_at: "2026-09-01T10:00:00Z",
      row_version: 1,
      server_seq: 5,
    };
    await db.as(account).sql("select sync_apply_many('vault_pages', $1::jsonb)", [JSON.stringify([row])]);
    const [local] = await db.sql<{ title: string }>("select title from vault_pages where id = $1", [page]);
    assert.equal(local!.title, "From the server");
    assert.equal((await ops(page)).length, 0);
  });

  it("applies a collaborator's row whose owner this device has never seen", async () => {
    const { db, account, project } = await adoptedDevice();
    const stranger = "00000000-0000-4000-9000-00000000beef";
    const entry = id();
    await db.as(account).sql("select sync_apply('log_entries', $1::jsonb)", [
      JSON.stringify({
        id: entry,
        user_id: stranger,
        project_id: project,
        entry_date: "2026-09-01",
        kind: "daily",
        body: "Theirs",
        links: [],
        created_at: "2026-09-01T10:00:00Z",
        row_version: 1,
        server_seq: 6,
      }),
    ]);
    const rows = await db.sql("select 1 from log_entries where id = $1", [entry]);
    assert.equal(rows.length, 1);
  });

  it("applies a pulled paper tag under the id the server derived", async () => {
    const { db, account, project, ops } = await adoptedDevice();
    const as = db.as(account);
    const [paper] = await as.sql<{ id: string }>(
      "insert into papers (user_id, project_id, title) values ($1, $2, 'Pulled') returning id",
      [account, project],
    );
    const [tag] = await as.sql<{ id: string }>(
      "insert into tags (user_id, project_id, name) values ($1, $2, 'pulled') returning id",
      [account, project],
    );
    const [{ id: linkId }] = (await db.sql<{ id: string }>(
      "select md5($1 || ':' || $2 || ':manual')::uuid as id",
      [paper!.id, tag!.id],
    )) as [{ id: string }];
    const row = { id: linkId, paper_id: paper!.id, tag_id: tag!.id, source: "manual", row_version: 1, server_seq: 7 };
    await as.sql("select sync_apply('paper_tags', $1::jsonb)", [JSON.stringify(row)]);
    await as.sql("select sync_apply('paper_tags', $1::jsonb)", [JSON.stringify({ ...row, row_version: 2 })]);
    const local = await db.sql<{ row_version: number }>("select row_version from paper_tags where id = $1", [linkId]);
    assert.deepEqual(local, [{ row_version: 2 }]);
    assert.equal((await ops(linkId)).length, 0);
  });

  it("removes the local row when the server sends a tombstone", async () => {
    const { db, account, project, ops } = await adoptedDevice();
    await db.as(account).sql("select sync_apply('projects', $1::jsonb)", [
      JSON.stringify({ id: project, user_id: account, name: "Thesis", deleted_at: new Date().toISOString() }),
    ]);
    const rows = await db.sql("select 1 from projects where id = $1", [project]);
    assert.equal(rows.length, 0);
    assert.equal((await ops(project)).length, 0);
  });
});

describe("local-first: adoption as the local user", () => {
  it("re-owns rows even though the local user's policies would refuse it", async () => {
    const db = await testDb();
    await db.sql("update sync_state set account_id = null");
    await db.sql("delete from sync_outbox");
    await db.sql("insert into auth.users (id, email) values ($1, 'local@device') on conflict do nothing", [
      LOCAL_USER_ID,
    ]);
    const project = id();
    await db.sql("insert into projects (id, user_id, name) values ($1, $2, 'Solo')", [project, LOCAL_USER_ID]);
    // A real account id this database has never seen, as on a fresh device.
    const account = "00000000-0000-4000-9000-0000000acc01";
    const asLocal = db.as(LOCAL_USER_ID);
    const result = await new Adoption(
      sqlRunner((q, p) => asLocal.sql(q, p as unknown[])),
      LOCAL_USER_ID,
    ).run({ accountId: account, remoteProjectNames: [], deviceLabel: "desktop" });
    assert.ok(result.claimed >= 1);
    const [row] = await db.sql<{ user_id: string }>("select user_id from projects where id = $1", [project]);
    assert.equal(row!.user_id, account);
    await db.sql("update sync_state set account_id = null");
  });
});

describe("local-first: queued payloads the server can take", () => {
  it("strips generated columns from any appended op", async () => {
    const { db, project } = await adoptedDevice();
    const page = id();
    await db.sql(
      "insert into sync_outbox (table_name, row_id, op, payload) values ('vault_pages', $1, 'update', $2::jsonb)",
      [page, JSON.stringify({ id: page, project_id: project, title: "T", body_preview: "x" })],
    );
    const [op] = await db.sql<Op>("select payload from sync_outbox where row_id = $1", [page]);
    assert.equal("body_preview" in op!.payload, false);
    assert.equal(op!.payload.title, "T");
  });

  it("claim re-owns payloads already queued for the local user", async () => {
    const { db, account } = await adoptedDevice();
    const row = id();
    await db.sql(
      "insert into sync_outbox (table_name, row_id, op, payload) values ('screening_decisions', $1, 'insert', $2::jsonb)",
      [row, JSON.stringify({ id: row, reviewer_id: LOCAL_USER_ID, state: "included" })],
    );
    await db.sql("select sync_claim($1, $2)", [account, LOCAL_USER_ID]);
    const [op] = await db.sql<Op>("select payload from sync_outbox where row_id = $1", [row]);
    assert.equal(op!.payload.reviewer_id, account);
  });

  it("repair drops dead duplicate inserts and revives the rest", async () => {
    const { db, project } = await adoptedDevice();
    const dup = id();
    const page = id();
    const dead =
      "insert into sync_outbox (table_name, row_id, op, payload, dead_at, attempts, last_error) values ($1, $2, $3, $4::jsonb, now(), 8, $5)";
    await db.sql(dead, ["papers", dup, "insert", JSON.stringify({ id: dup }), "A newer version on the server."]);
    await db.sql(dead, ["vault_pages", page, "update", JSON.stringify({ id: page, project_id: project }), "x"]);
    const migration = readFileSync(
      new URL("../../../../../../supabase/migrations-local/0016_outbox_clean_payloads.sql", import.meta.url),
      "utf8",
    );
    await db.sql(migration.slice(migration.lastIndexOf("do $$")));
    assert.equal((await db.sql("select 1 from sync_outbox where row_id = $1", [dup])).length, 0);
    const [op] = await db.sql<{ dead_at: string | null; attempts: number }>(
      "select dead_at, attempts from sync_outbox where row_id = $1",
      [page],
    );
    assert.deepEqual(op, { dead_at: null, attempts: 0 });
  });
});
