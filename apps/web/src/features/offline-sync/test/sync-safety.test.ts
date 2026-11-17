import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LOCAL_USER_ID } from "@weaveforge/core";
import { testDb } from "../../../backend/test/pg-test-db";
import { sqlRunner } from "./local-sql";
import { SyncEngine } from "../domain/parts-3";
import { Outbox, type OutboxEntry } from "../domain/parts-2";
import type { RemoteChange, SendOutcome, SyncTransport } from "../domain/parts";

interface Recorder extends SyncTransport {
  tables: string[];
  pulls: number[];
}

/** Records what leaves the device and every `since` the engine asks the feed for. */
function recording(changes: RemoteChange[] = []): Recorder {
  const fake: Recorder = {
    tables: [],
    pulls: [],
    send: async (entry: OutboxEntry): Promise<SendOutcome> => {
      fake.tables.push(entry.table);
      return { status: "accepted" };
    },
    changesSince: async (since: number) => {
      fake.pulls.push(since);
      return since === 0 ? changes : changes.filter((c) => c.serverSeq > since);
    },
  };
  return fake;
}

async function freshDevice() {
  const db = await testDb();
  await db.sql("update sync_state set account_id = null, watermark = 0, github_scope = false");
  await db.sql("delete from projects where id = $1", [ROW]);
  await db.sql("delete from sync_outbox");
  await db.sql("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", [
    LOCAL_USER_ID,
    "local@device",
  ]);
  return { db, sql: sqlRunner((q, p) => db.sql(q, p as unknown[])) };
}

const ROW = "00000000-0000-4000-8000-00000000f001";

function projectChange(owner: string | null, seq: number, id = ROW): RemoteChange {
  return {
    table: "projects",
    rowId: id,
    serverSeq: seq,
    deletedAt: null,
    rowVersion: 1,
    row: {
      id,
      ...(owner === null ? {} : { user_id: owner }),
      name: `from ${owner ?? "nobody"}`,
      server_seq: seq,
      row_version: 1,
      created_at: "2026-01-01T00:00:00Z",
    },
  };
}

describe("S1: a transient scope failure never moves the watermark", () => {
  it("aborts the cycle before any push or pull when the GitHub check throws", async () => {
    const { db, sql } = await freshDevice();
    await db.sql(
      "insert into sync_outbox (table_name, row_id, op, payload) values ('projects', gen_random_uuid(), 'insert', '{}'::jsonb)",
    );
    const net = recording([projectChange(LOCAL_USER_ID, 8100)]);
    const engine = new SyncEngine(sql, net, LOCAL_USER_ID, undefined, async () => {
      throw new Error("boom");
    });

    await assert.rejects(() => engine.cycle(), /boom/);

    assert.deepEqual(net.tables, [], "nothing may be sent on an unknown scope");
    assert.deepEqual(net.pulls, [], "nothing may be pulled on an unknown scope");
    const [state] = await db.sql<{ watermark: string }>("select watermark from sync_state");
    assert.equal(Number(state!.watermark), 0);
  });

  it("re-reads skipped workspace rows after GitHub is disconnected (no data loss)", async () => {
    const { db, sql } = await freshDevice();
    const change = projectChange(LOCAL_USER_ID, 8101);
    const net = recording([change]);

    // Connected: the owned row is out of scope, so it is skipped and not written.
    await new SyncEngine(sql, net, LOCAL_USER_ID, undefined, async () => true).cycle();
    assert.equal((await db.sql("select id from projects where id = $1", [ROW])).length, 0);

    // Disconnected: the feed must be read again from the start, so the row arrives.
    net.pulls.length = 0;
    await new SyncEngine(sql, net, LOCAL_USER_ID, undefined, async () => false).cycle();
    assert.equal(net.pulls[0], 0, "the first disconnected pull starts at watermark 0");
    assert.equal((await db.sql("select id from projects where id = $1", [ROW])).length, 1);
  });
});

describe("S2: pull scope follows ownership, not kind names", () => {
  it("while connected, a row owned by someone else (shared in) is applied", async () => {
    const { db, sql } = await freshDevice();
    const other = await db.createUser();
    const net = recording([projectChange(other, 8200)]);

    await new SyncEngine(sql, net, LOCAL_USER_ID, undefined, async () => true).cycle();

    assert.equal((await db.sql("select id from projects where id = $1", [ROW])).length, 1);
  });

  it("while connected, a row owned by this device is not applied", async () => {
    const { db, sql } = await freshDevice();
    const net = recording([projectChange(LOCAL_USER_ID, 8201)]);

    await new SyncEngine(sql, net, LOCAL_USER_ID, undefined, async () => true).cycle();

    assert.equal((await db.sql("select id from projects where id = $1", [ROW])).length, 0);
  });

  it("while connected, a row with no owner is not applied (fail closed)", async () => {
    const { db, sql } = await freshDevice();
    const net = recording([projectChange(null, 8202)]);

    await new SyncEngine(sql, net, LOCAL_USER_ID, undefined, async () => true).cycle();

    assert.equal((await db.sql("select id from projects where id = $1", [ROW])).length, 0);
  });
});

describe("S3: the outbox is bounded while GitHub is connected", () => {
  async function queue(db: Awaited<ReturnType<typeof testDb>>, rowId: string, table = "projects") {
    await db.sql(
      `insert into sync_outbox (table_name, row_id, op, payload, base_version, base_payload) values
       ($1, $2, 'update', '{"name":"a"}'::jsonb, 1, '{"name":"base"}'::jsonb),
       ($1, $2, 'update', '{"name":"b"}'::jsonb, 2, '{"name":"b0"}'::jsonb),
       ($1, $2, 'update', '{"name":"c"}'::jsonb, 3, '{"name":"c0"}'::jsonb)`,
      [table, rowId],
    );
  }

  it("coalesces repeated edits of a workspace row into one op: first base, latest payload", async () => {
    const { db, sql } = await freshDevice();
    const rowId = "00000000-0000-4000-8000-00000000f010";
    await queue(db, rowId);

    await new Outbox(sql).coalesceWorkspace(true);

    const rows = await db.sql<{ payload: { name: string }; base_version: number; base_payload: { name: string } }>(
      "select payload, base_version, base_payload from sync_outbox where row_id = $1",
      [rowId],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.payload.name, "c");
    assert.equal(rows[0]!.base_version, 1);
    assert.equal(rows[0]!.base_payload.name, "base");
  });

  it("leaves the outbox alone when GitHub is not connected", async () => {
    const { db, sql } = await freshDevice();
    const rowId = "00000000-0000-4000-8000-00000000f011";
    await queue(db, rowId);

    await new Outbox(sql).coalesceWorkspace(false);

    assert.equal((await db.sql("select 1 from sync_outbox where row_id = $1", [rowId])).length, 3);
  });

  it("never coalesces sharing ops, which the server needs in order", async () => {
    const { db, sql } = await freshDevice();
    const rowId = "00000000-0000-4000-8000-00000000f012";
    await queue(db, rowId, "shares");

    await new Outbox(sql).coalesceWorkspace(true);

    assert.equal((await db.sql("select 1 from sync_outbox where row_id = $1", [rowId])).length, 3);
  });
});
