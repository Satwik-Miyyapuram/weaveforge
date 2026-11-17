import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LOCAL_USER_ID } from "@weaveforge/core";
import { testDb } from "../../../backend/test/pg-test-db";
import { sqlRunner } from "./local-sql";
import { SyncEngine } from "../domain/parts-3";
import { SHARING_KINDS, ownerOf, shouldApplyPulled } from "../domain/sync-scope";
import type { OutboxEntry } from "../domain/parts-2";
import type { RemoteChange, SendOutcome, SyncTransport } from "../domain/parts";

/** Records every table the engine sends, so a test can ask what left the device. */
function recording(changes: RemoteChange[] = []): SyncTransport & { tables: string[] } {
  const fake = {
    tables: [] as string[],
    send: async (entry: OutboxEntry): Promise<SendOutcome> => {
      fake.tables.push(entry.table);
      return { status: "accepted" };
    },
    changesSince: async () => changes,
  };
  return fake;
}

const WORKSPACE_KINDS = ["projects", "papers", "vault_pages", "notes", "tags", "log_entries"];

async function seededDevice() {
  const db = await testDb();
  await db.sql("update sync_state set account_id = null, watermark = 0");
  await db.sql("delete from sync_outbox");
  await db.sql("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", [
    LOCAL_USER_ID,
    "local@device",
  ]);
  // One row of each workspace kind, and one shares and one comments op: what
  // the device owes the server before any gate applies.
  for (const table of [...WORKSPACE_KINDS, "shares", "comments"]) {
    await db.sql(
      "insert into sync_outbox (table_name, row_id, op, payload) values ($1, gen_random_uuid(), 'insert', '{}'::jsonb)",
      [table],
    );
  }
  return { db, sql: sqlRunner((q, p) => db.sql(q, p as unknown[])) };
}

function change(owner: string | null, id: string, seq: number, deletedAt: string | null = null): RemoteChange {
  return {
    table: "projects",
    rowId: id,
    serverSeq: seq,
    deletedAt,
    rowVersion: 1,
    row: {
      id,
      ...(owner === null ? {} : { user_id: owner }),
      name: "pulled",
      server_seq: seq,
      row_version: 1,
      created_at: "2026-01-01T00:00:00Z",
    },
  };
}

describe("the sharing kinds and owner rule", () => {
  it("names the sharing tables that are pushed on their own", () => {
    assert.deepEqual([...SHARING_KINDS].sort(), ["ai_mcp_relay_requests", "comments", "share_links", "shares"]);
  });

  it("reads the owner from user_id or owner_id, lower-cased, or null", () => {
    assert.equal(ownerOf({ user_id: "ABC" }), "abc");
    assert.equal(ownerOf({ owner_id: "xyz" }), "xyz");
    assert.equal(ownerOf({ user_id: "" }), null);
    assert.equal(ownerOf({}), null);
  });

  it("writes every pulled change when GitHub is not connected", () => {
    assert.equal(shouldApplyPulled(change(null, "a", 1), LOCAL_USER_ID, false), true);
    assert.equal(shouldApplyPulled(change(LOCAL_USER_ID, "a", 1), LOCAL_USER_ID, false), true);
  });

  it("writes a live row only when someone else owns it, while connected", () => {
    assert.equal(shouldApplyPulled(change("someone-else", "a", 1), LOCAL_USER_ID, true), true);
    assert.equal(shouldApplyPulled(change(LOCAL_USER_ID, "a", 1), LOCAL_USER_ID, true), false);
    assert.equal(shouldApplyPulled(change(null, "a", 1), LOCAL_USER_ID, true), false, "no owner: fail closed");
    assert.equal(shouldApplyPulled(change("someone-else", "a", 1), "", true), false, "no local user: fail closed");
  });

  it("always passes deletes, so a local copy of a deleted row goes", () => {
    assert.equal(shouldApplyPulled(change(LOCAL_USER_ID, "a", 1, "2026-02-01T00:00:00Z"), LOCAL_USER_ID, true), true);
  });
});

describe("the sync engine under the scope gate", () => {
  it("when GitHub is connected, pushes shares and comments and no workspace rows", async () => {
    const { sql } = await seededDevice();
    const net = recording();
    const engine = new SyncEngine(sql, net, LOCAL_USER_ID, undefined, async () => true);

    await engine.cycle();

    assert.ok(net.tables.includes("shares"), "shares should go up");
    assert.ok(net.tables.includes("comments"), "comments should go up");
    for (const kind of WORKSPACE_KINDS) {
      assert.equal(net.tables.includes(kind), false, `${kind} must not be pushed`);
    }
  });

  it("when GitHub is not connected, pushes every queued row as before", async () => {
    const { sql } = await seededDevice();
    const net = recording();
    const engine = new SyncEngine(sql, net, LOCAL_USER_ID, undefined, async () => false);

    await engine.cycle();

    for (const kind of [...WORKSPACE_KINDS, "shares", "comments"]) {
      assert.ok(net.tables.includes(kind), `${kind} should be pushed`);
    }
  });

  it("when GitHub is connected, a pull of a row this device owns writes nothing", async () => {
    const db = await testDb();
    await db.sql("update sync_state set account_id = null, watermark = 0");
    await db.sql("delete from sync_outbox");
    const id = "00000000-0000-4000-8000-00000000e001";
    const sql = sqlRunner((q, p) => db.sql(q, p as unknown[]));
    const engine = new SyncEngine(sql, recording([change(LOCAL_USER_ID, id, 8001)]), LOCAL_USER_ID, undefined, async () => true);

    await engine.cycle();

    const rows = await db.sql<{ id: string }>("select id from projects where id = $1", [id]);
    assert.equal(rows.length, 0, "a workspace row owned here must not be written from the server");
  });

  it("when GitHub is connected, a row shared in by someone else is written", async () => {
    const db = await testDb();
    const other = await db.createUser();
    await db.sql("update sync_state set account_id = null, watermark = 0");
    await db.sql("delete from sync_outbox");
    const id = "00000000-0000-4000-8000-00000000e003";
    const sql = sqlRunner((q, p) => db.sql(q, p as unknown[]));
    const engine = new SyncEngine(sql, recording([change(other, id, 8003)]), LOCAL_USER_ID, undefined, async () => true);

    await engine.cycle();

    const rows = await db.sql<{ id: string }>("select id from projects where id = $1", [id]);
    assert.equal(rows.length, 1);
  });

  it("when GitHub is not connected, the same pull writes the row as before", async () => {
    const db = await testDb();
    const user = await db.createUser();
    await db.sql("update sync_state set account_id = null, watermark = 0");
    await db.sql("delete from sync_outbox");
    const id = "00000000-0000-4000-8000-00000000e002";
    const sql = sqlRunner((q, p) => db.sql(q, p as unknown[]));
    const engine = new SyncEngine(sql, recording([change(user, id, 8002)]), LOCAL_USER_ID, undefined, async () => false);

    await engine.cycle();

    const rows = await db.sql<{ id: string }>("select id from projects where id = $1", [id]);
    assert.equal(rows.length, 1);
  });
});
