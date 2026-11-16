import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LOCAL_USER_ID } from "@weaveforge/core";
import { testDb } from "../../../backend/test/pg-test-db";
import { sqlRunner } from "./local-sql";
import { SyncEngine } from "../domain/parts-3";
import { shouldSyncRowKind, SHARED_ROW_KINDS } from "../domain/sync-scope";
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
  // One row of each workspace kind, and one shared item and one comment: what
  // the device owes the server before any gate applies.
  for (const table of [...WORKSPACE_KINDS, "shares", "comments"]) {
    await db.sql(
      "insert into sync_outbox (table_name, row_id, op, payload) values ($1, gen_random_uuid(), 'insert', '{}'::jsonb)",
      [table],
    );
  }
  return { db, sql: sqlRunner((q, p) => db.sql(q, p as unknown[])) };
}

describe("the row-kind scope predicate", () => {
  it("keeps only shared items and the live relay when GitHub is connected", () => {
    for (const kind of ["shares", "share_links", "comments", "ai_mcp_relay_requests"]) {
      assert.equal(shouldSyncRowKind(kind, true), true, kind);
    }
    for (const kind of WORKSPACE_KINDS) {
      assert.equal(shouldSyncRowKind(kind, true), false, kind);
    }
  });

  it("passes every kind through when GitHub is not connected", () => {
    for (const kind of [...WORKSPACE_KINDS, "shares", "comments"]) {
      assert.equal(shouldSyncRowKind(kind, false), true, kind);
    }
  });

  it("lists the shared kinds it allows, so the outbox query and the predicate agree", () => {
    for (const kind of SHARED_ROW_KINDS) {
      assert.equal(shouldSyncRowKind(kind, true), true, kind);
    }
    assert.equal(SHARED_ROW_KINDS.includes("papers" as never), false);
  });
});

describe("the sync engine under the scope gate", () => {
  it("when GitHub is connected, pushes shares, comments and relay, and no workspace rows", async () => {
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

  it("when GitHub is connected, a server pull writes no workspace rows", async () => {
    const db = await testDb();
    const user = await db.createUser();
    await db.sql("update sync_state set account_id = null, watermark = 0");
    await db.sql("delete from sync_outbox");
    const id = "00000000-0000-4000-8000-00000000e001";
    const change: RemoteChange = {
      table: "projects",
      rowId: id,
      serverSeq: 8001,
      deletedAt: null,
      rowVersion: 1,
      row: {
        id,
        user_id: user,
        name: "pulled while connected",
        server_seq: 8001,
        row_version: 1,
        created_at: "2026-01-01T00:00:00Z",
      },
    };
    const sql = sqlRunner((q, p) => db.sql(q, p as unknown[]));
    const engine = new SyncEngine(sql, recording([change]), LOCAL_USER_ID, undefined, async () => true);

    await engine.cycle();

    const rows = await db.sql<{ id: string }>("select id from projects where id = $1", [id]);
    assert.equal(rows.length, 0, "a workspace row must not be written from the server");
  });

  it("when GitHub is not connected, the same pull writes the row as before", async () => {
    const db = await testDb();
    const user = await db.createUser();
    await db.sql("update sync_state set account_id = null, watermark = 0");
    await db.sql("delete from sync_outbox");
    const id = "00000000-0000-4000-8000-00000000e002";
    const change: RemoteChange = {
      table: "projects",
      rowId: id,
      serverSeq: 8002,
      deletedAt: null,
      rowVersion: 1,
      row: {
        id,
        user_id: user,
        name: "pulled while signed out of GitHub",
        server_seq: 8002,
        row_version: 1,
        created_at: "2026-01-01T00:00:00Z",
      },
    };
    const sql = sqlRunner((q, p) => db.sql(q, p as unknown[]));
    const engine = new SyncEngine(sql, recording([change]), LOCAL_USER_ID, undefined, async () => false);

    await engine.cycle();

    const rows = await db.sql<{ id: string }>("select id from projects where id = $1", [id]);
    assert.equal(rows.length, 1);
  });
});
