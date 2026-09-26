import assert from "node:assert/strict";
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
