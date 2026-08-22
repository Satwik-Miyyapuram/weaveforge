import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { testDb } from "../../../backend/test/pg-test-db";
import { sqlRunner } from "./local-sql";
import { Puller } from "../domain/puller";
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

  it("keeps a tombstone as a row rather than letting it disappear", async () => {
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

    const [stored] = await db.sql<{ deleted_at: string | null }>(
      "select deleted_at from projects where id = $1",
      [id],
    );
    assert.notEqual(stored, undefined);
    assert.notEqual(stored!.deleted_at, null);
  });

  it("refuses to write a table that is not part of sync", async () => {
    const db = await testDb();
    const sql = sqlRunner((q, p) => db.sql(q, p as unknown[]));
    const state = new SyncStateStore(sql);
    await assert.rejects(
      new Puller(sql, state, transport([[change({ table: "api_tokens", row: { id: "x" } })]])).pull(),
      /not a synced table/,
    );
  });
});
