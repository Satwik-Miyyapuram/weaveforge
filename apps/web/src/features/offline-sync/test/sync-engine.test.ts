import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LOCAL_USER_ID } from "@weaveforge/core";
import { testDb } from "../../../backend/test/pg-test-db";
import { sqlRunner } from "./local-sql";
import { SyncEngine, SyncRefusedError, type SyncQuota } from "../domain/sync-engine";
import type { RemoteChange, SendOutcome, SyncTransport } from "../domain/sync-ports";

function transport(
  outcome: SendOutcome = { status: "accepted" },
  changes: RemoteChange[] = [],
): SyncTransport & { sent: number; pulls: number } {
  const fake = {
    sent: 0,
    pulls: 0,
    send: async () => {
      fake.sent += 1;
      return outcome;
    },
    changesSince: async () => {
      fake.pulls += 1;
      return changes;
    },
  };
  return fake;
}

let nextId = 0;
function projectId(): string {
  nextId += 1;
  return `00000000-0000-4000-8000-${String(1000 + nextId).padStart(12, "0")}`;
}

async function device(projects: readonly string[]) {
  const db = await testDb();
  await db.sql("update sync_state set account_id = null, watermark = 0");
  await db.sql("delete from sync_outbox");
  await db.sql("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", [
    LOCAL_USER_ID,
    "local@device",
  ]);
  for (const name of projects) {
    await db.sql("insert into projects (id, user_id, name) values ($1, $2, $3)", [
      projectId(),
      LOCAL_USER_ID,
      name,
    ]);
  }
  return { db, sql: sqlRunner((q, p) => db.sql(q, p as unknown[])) };
}

describe("the sync engine", () => {
  it("is off until a device is adopted", async () => {
    const { sql } = await device([]);
    assert.equal(await new SyncEngine(sql, transport(), LOCAL_USER_ID).enabled(), false);
  });

  it("adopts and then delivers the backfill in one opt-in", async () => {
    const { db, sql } = await device(["Thesis"]);
    const net = transport();
    const engine = new SyncEngine(sql, net, LOCAL_USER_ID);

    const result = await engine.enable({
      accountId: await db.createUser(),
      remoteProjectNames: [],
      deviceLabel: "desktop",
    });

    assert.equal(result.queued, 1);
    assert.equal(net.sent, 1);
    assert.equal(await engine.enabled(), true);
    const [left] = await db.sql<{ count: string }>("select count(*) as count from sync_outbox");
    assert.equal(Number(left!.count), 0);
  });

  it("refuses before it rewrites anything, so a no is not half-applied", async () => {
    const { db, sql } = await device(["Thesis"]);
    const quota: SyncQuota = {
      check: async () => ({ allowed: false, reason: "Sync is not available on this plan." }),
    };
    const engine = new SyncEngine(sql, transport(), LOCAL_USER_ID, quota);
    const account = await db.createUser();

    await assert.rejects(
      () => engine.enable({ accountId: account, remoteProjectNames: [], deviceLabel: "desktop" }),
      SyncRefusedError,
    );
    assert.equal(await engine.enabled(), false);
    const [owned] = await db.sql<{ count: string }>(
      "select count(*) as count from projects where user_id = $1",
      [account],
    );
    assert.equal(Number(owned!.count), 0);
  });

  it("pushes before it pulls", async () => {
    const { db, sql } = await device(["Thesis"]);
    const order: string[] = [];
    const net: SyncTransport = {
      send: async () => {
        order.push("push");
        return { status: "accepted" };
      },
      changesSince: async () => {
        order.push("pull");
        return [];
      },
    };
    const engine = new SyncEngine(sql, net, LOCAL_USER_ID);
    await new SyncEngine(sql, transport({ status: "offline" }), LOCAL_USER_ID).enable({
      accountId: await db.createUser(),
      remoteProjectNames: [],
      deviceLabel: "desktop",
    });
    order.length = 0;

    await engine.cycle();

    // Rows left local by the refused adoption above ride along, so what is
    // under test is the order, not the count.
    assert.equal(order.at(-1), "pull");
    assert.ok(order.slice(0, -1).every((step) => step === "push"));
    assert.ok(order.length > 1);
  });

  it("does not pull when the push found the network down", async () => {
    const { db, sql } = await device(["Thesis"]);
    const net = transport({ status: "offline" });
    const engine = new SyncEngine(sql, net, LOCAL_USER_ID);
    await engine.enable({
      accountId: await db.createUser(),
      remoteProjectNames: [],
      deviceLabel: "desktop",
    });

    const result = await engine.cycle();

    assert.equal(result.pushed.stoppedBecause, "offline");
    assert.equal(result.pulled.applied, 0);
    assert.equal(net.pulls, 0);
  });

  it("queues a project ahead of the papers in it", async () => {
    const { db, sql } = await device(["Thesis"]);
    await db.sql(
      "insert into papers (user_id, project_id, title) select $1, id, 'Attention' from projects where name = 'Thesis' and user_id = $1",
      [LOCAL_USER_ID],
    );
    await new SyncEngine(sql, transport({ status: "offline" }), LOCAL_USER_ID).enable({
      accountId: await db.createUser(),
      remoteProjectNames: [],
      deviceLabel: "desktop",
    });

    const order = await db.sql<{ table_name: string }>("select table_name from sync_outbox order by seq");
    const tables = order.map((r) => r.table_name);
    assert.ok(tables.includes("papers"));
    assert.ok(tables.indexOf("projects") < tables.indexOf("papers"), tables.join(","));
  });

  it("sends again only the rows the server never got, once", async () => {
    const { db, sql } = await device(["Thesis", "Notes"]);
    const account = await db.createUser();
    await new SyncEngine(sql, transport(), LOCAL_USER_ID).enable({
      accountId: account,
      remoteProjectNames: [],
      deviceLabel: "desktop",
    });
    const projects = await db.sql<{ id: string }>(
      "select id from projects where user_id = $1 and deleted_at is null order by id",
      [account],
    );
    const lost = projects[0]!.id;
    await db.sql("update sync_state set resend_checked_at = null");
    const asked: string[][] = [];
    const net = Object.assign(transport(), {
      missingIds: async (table: string, ids: string[]) => {
        if (table === "projects") asked.push(ids);
        return table === "projects" ? ids.filter((id) => id === lost) : [];
      },
    });
    const engine = new SyncEngine(sql, net, LOCAL_USER_ID);

    await engine.cycle();
    assert.deepEqual(asked, [projects.map((p) => p.id)]);
    assert.equal(net.sent, 1);
    const [flag] = await db.sql<{ checked: boolean }>("select resend_checked_at is not null as checked from sync_state");
    assert.equal(flag!.checked, true);

    await engine.cycle();
    assert.equal(asked.length, 1);
    assert.equal(net.sent, 1);
  });

  it("leaves the question open when the server cannot be read", async () => {
    const { db, sql } = await device(["Thesis"]);
    await new SyncEngine(sql, transport(), LOCAL_USER_ID).enable({
      accountId: await db.createUser(),
      remoteProjectNames: [],
      deviceLabel: "desktop",
    });
    await db.sql("update sync_state set resend_checked_at = null");
    const net = Object.assign(transport(), { missingIds: async () => null });

    await new SyncEngine(sql, net, LOCAL_USER_ID).cycle();

    assert.equal(net.sent, 0);
    const [flag] = await db.sql<{ checked: boolean }>("select resend_checked_at is not null as checked from sync_state");
    assert.equal(flag!.checked, false);
  });
});
