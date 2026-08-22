import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LOCAL_USER_ID } from "@weaveforge/core";
import { testDb } from "../../../backend/test/pg-test-db";
import { sqlRunner } from "./local-sql";
import { Adoption, AlreadyAdoptedError } from "../domain/adoption";
import { SyncStateStore } from "../domain/sync-state";

// The harness hands back one database, so ids have to be unique across tests.
let nextId = 0;
function projectId(): string {
  nextId += 1;
  return `00000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`;
}

/** A device with local work, owned by the synthetic local user. */
async function deviceWith(names: readonly string[]) {
  const db = await testDb();
  // One database serves the whole file, so each device starts un-adopted with
  // an empty queue.
  await db.sql("update sync_state set account_id = null, watermark = 0");
  await db.sql("delete from sync_outbox");
  await db.sql("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", [
    LOCAL_USER_ID,
    "local@device",
  ]);
  const ids: string[] = [];
  for (const name of names) {
    const id = projectId();
    await db.sql("insert into projects (id, user_id, name) values ($1, $2, $3)", [
      id,
      LOCAL_USER_ID,
      name,
    ]);
    ids.push(id);
  }
  return { db, ids, sql: sqlRunner((q, p) => db.sql(q, p as unknown[])) };
}

describe("adoption", () => {
  it("hands local rows to the account without changing their ids", async () => {
    const { db, ids, sql } = await deviceWith(["Thesis"]);

    const account = await db.createUser();
    const result = await new Adoption(sql, LOCAL_USER_ID).run({
      accountId: account,
      remoteProjectNames: [],
      deviceLabel: "desktop",
    });

    assert.equal(result.claimed, 1);
    const [row] = await db.sql<{ user_id: string }>("select user_id from projects where id = $1", [
      ids[0]!,
    ]);
    assert.equal(row!.user_id, account);
    assert.equal((await new SyncStateStore(sql).read()).accountId, account);
  });

  it("queues every adopted row so the account learns about work it never saw", async () => {
    const { db, sql } = await deviceWith(["Thesis", "Side quest"]);

    const result = await new Adoption(sql, LOCAL_USER_ID).run({
      accountId: await db.createUser(),
      remoteProjectNames: [],
      deviceLabel: "desktop",
    });

    assert.equal(result.queued, 2);
    const queued = await db.sql<{ op: string; base_version: number | null; payload: { name: string } }>(
      "select op, base_version, payload from sync_outbox order by seq",
    );
    assert.deepEqual(
      queued.map((q) => q.op),
      ["insert", "insert"],
    );
    assert.equal(queued[0]!.base_version, null);
    assert.ok(queued.some((q) => q.payload.name === "Thesis"));
  });

  it("renames a colliding project rather than merging it", async () => {
    const { db, sql } = await deviceWith(["Thesis", "Side quest"]);
    const account = await db.createUser();

    const result = await new Adoption(sql, LOCAL_USER_ID).run({
      accountId: account,
      remoteProjectNames: ["Thesis"],
      deviceLabel: "desktop",
    });

    assert.deepEqual(
      result.renamed.map((r) => [r.from, r.to]),
      [["Thesis", "Thesis (desktop)"]],
    );
    const names = (
      await db.sql<{ name: string }>(
        "select name from projects where user_id = $1 order by name",
        [account],
      )
    ).map((r) => r.name);
    assert.deepEqual(names, ["Side quest", "Thesis (desktop)"]);
  });

  it("counts past a suffix the account already holds", async () => {
    const { db, sql } = await deviceWith(["Thesis"]);

    const result = await new Adoption(sql, LOCAL_USER_ID).run({
      accountId: await db.createUser(),
      remoteProjectNames: ["Thesis", "Thesis (desktop)"],
      deviceLabel: "desktop",
    });

    assert.equal(result.renamed[0]!.to, "Thesis (desktop 2)");
  });

  it("refuses a second adoption, which would move rows between accounts", async () => {
    const { db, sql } = await deviceWith(["Thesis"]);
    const adoption = new Adoption(sql, LOCAL_USER_ID);
    await adoption.run({ accountId: await db.createUser(), remoteProjectNames: [], deviceLabel: "a" });

    await assert.rejects(
      () =>
        adoption.run({
          accountId: "00000000-0000-4000-8000-0000000dfffe",
          remoteProjectNames: [],
          deviceLabel: "b",
        }),
      AlreadyAdoptedError,
    );
  });
});
