import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LOCAL_USER_ID } from "@weaveforge/core";
import { localSqlDb, type LocalSqlDb } from "./local-sql";
import { Outbox } from "../domain/parts-2";
import { SyncEngine } from "../domain/parts-3";
import type { SyncTransport } from "../domain/parts";
import { reconcileSharedRows, SharedRowMarks, withShareMarks, type ShareRef } from "../domain/shared-rows";

/**
 * Device-only tests: they run against the local migrations alone (PGlite, no
 * app schema). Tests that drive SyncEngine.cycle need the Rust core (wasm), so
 * they are marked below and cannot run without a built wf-wasm package.
 *
 * Share rows use the server's shape (owner_id, recipient_id, resource_type,
 * resource_id nullable): the marker is filled from what the server lists for
 * this account, so these fakes return those shares, not outbox ops.
 */

const ACCOUNT = "00000000-0000-4000-8000-0000000000a1";
const OTHER_USER = "00000000-0000-4000-8000-0000000000b2";
const PAPER = "00000000-0000-4000-8000-00000000f020";
const OTHER_PAPER = "00000000-0000-4000-8000-00000000f022";
const SHARE = "00000000-0000-4000-8000-00000000f021";
const SHARE_ALL = "00000000-0000-4000-8000-00000000f023";

/** A fake server: `ownShares` answers with the given list, or fails with the given error. */
function server(answer: ShareRef[] | null | Error): SyncTransport {
  return {
    send: async () => ({ status: "accepted" }),
    changesSince: async () => [],
    ownShares: async () => {
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

function shareOf(shareId: string, resourceId: string | null, resourceType = "paper"): ShareRef {
  return { shareId, resourceType, resourceId };
}

async function markers(sql: LocalSqlDb): Promise<string[]> {
  const rows = await sql.query<{ share_id: string }>("select share_id from sync_shared_rows order by share_id");
  return rows.map((r) => r.share_id);
}

/** Table/row pairs the outbox would send while GitHub is connected. */
async function owedWhileConnected(sql: LocalSqlDb): Promise<string[]> {
  const ops = await new Outbox(sql).pending(100, true);
  return ops.map((op) => `${op.table}/${op.rowId}`);
}

async function editPaper(sql: LocalSqlDb, rowId: string) {
  await new Outbox(sql).append({
    table: "papers",
    rowId,
    op: "update",
    payload: { title: "edited" },
    baseVersion: 1,
    basePayload: { title: "old" },
  });
}

/** The share repository as the backend hands it out, minus the network. */
function fakeShareRepository() {
  const revoked: string[] = [];
  const repo = {
    grant: async (_input: { recipientId: string; resourceType: string; resourceId: string | null }) => ({
      id: SHARE,
      ownerId: ACCOUNT,
      recipientId: OTHER_USER,
      resourceType: "paper",
      resourceId: PAPER,
      access: "view" as const,
      createdAt: "2026-11-17T00:00:00Z",
    }),
    revoke: async (id: string) => {
      revoked.push(id);
    },
    revoked,
  };
  return repo;
}

describe("reconcile: markers follow the server's own shares", () => {
  it("other-device share marked after reconcile, so local edits push", async () => {
    const sql = await localSqlDb();
    const marks = new SharedRowMarks(sql);
    // Shared on another device: this device has no record of it.
    assert.equal(await reconcileSharedRows(marks, server([shareOf(SHARE, PAPER)]), ACCOUNT), true);
    assert.deepEqual(await markers(sql), [SHARE]);
    await editPaper(sql, PAPER);
    assert.deepEqual(await owedWhileConnected(sql), ["papers/" + PAPER]);
  });

  it("revoke elsewhere unmarks after reconcile, so edits stay on the device", async () => {
    const sql = await localSqlDb();
    const marks = new SharedRowMarks(sql);
    await reconcileSharedRows(marks, server([shareOf(SHARE, PAPER)]), ACCOUNT);
    // The server no longer lists the share: revoked on another device.
    assert.equal(await reconcileSharedRows(marks, server([]), ACCOUNT), true);
    assert.deepEqual(await markers(sql), []);
    await editPaper(sql, PAPER);
    assert.deepEqual(await owedWhileConnected(sql), []);
  });

  it("fetch failure keeps markers: a failed read is not proof the share is gone", async () => {
    const sql = await localSqlDb();
    const marks = new SharedRowMarks(sql);
    await reconcileSharedRows(marks, server([shareOf(SHARE, PAPER)]), ACCOUNT);
    assert.equal(await reconcileSharedRows(marks, server(null), ACCOUNT), false);
    assert.equal(await reconcileSharedRows(marks, server(new Error("offline")), ACCOUNT), false);
    assert.deepEqual(await markers(sql), [SHARE]);
  });

  it("type-wide share (resource_id NULL) makes every row of that type push", async () => {
    const sql = await localSqlDb();
    const marks = new SharedRowMarks(sql);
    await reconcileSharedRows(marks, server([shareOf(SHARE_ALL, null)]), ACCOUNT);
    await editPaper(sql, OTHER_PAPER);
    assert.deepEqual(await owedWhileConnected(sql), ["papers/" + OTHER_PAPER]);
  });

  it("a type-wide share does not make rows of another type push", async () => {
    const sql = await localSqlDb();
    const marks = new SharedRowMarks(sql);
    await reconcileSharedRows(marks, server([shareOf(SHARE_ALL, null, "milestone")]), ACCOUNT);
    await editPaper(sql, PAPER);
    assert.deepEqual(await owedWhileConnected(sql), []);
  });
});

describe("grant and revoke mark and unmark at once, before any cycle", () => {
  it("a grant marks its row, so the next edit pushes without waiting for a sync cycle", async () => {
    const sql = await localSqlDb();
    const marks = new SharedRowMarks(sql);
    const shares = withShareMarks(fakeShareRepository(), marks);
    await shares.grant({ recipientId: OTHER_USER, resourceType: "paper", resourceId: PAPER });
    assert.deepEqual(await markers(sql), [SHARE]);
    await editPaper(sql, PAPER);
    assert.deepEqual(await owedWhileConnected(sql), ["papers/" + PAPER]);
  });

  it("a failed grant marks nothing", async () => {
    const sql = await localSqlDb();
    const repo = fakeShareRepository();
    repo.grant = async () => {
      throw new Error("permission denied");
    };
    await assert.rejects(withShareMarks(repo, new SharedRowMarks(sql)).grant({
      recipientId: OTHER_USER,
      resourceType: "paper",
      resourceId: PAPER,
    }));
    assert.deepEqual(await markers(sql), []);
  });

  it("a revoke unmarks at once, and the row stays on the device", async () => {
    const sql = await localSqlDb();
    const marks = new SharedRowMarks(sql);
    const repo = fakeShareRepository();
    const shares = withShareMarks(repo, marks);
    await shares.grant({ recipientId: OTHER_USER, resourceType: "paper", resourceId: PAPER });
    await shares.revoke(SHARE);
    assert.deepEqual(repo.revoked, [SHARE]);
    assert.deepEqual(await markers(sql), []);
    await editPaper(sql, PAPER);
    assert.deepEqual(await owedWhileConnected(sql), []);
  });

  it("a marker write that throws after a grant still resolves with the share", async () => {
    const failing = {
      mark: async () => {
        throw new Error("database locked");
      },
      unmark: async () => {},
    };
    const shares = withShareMarks(fakeShareRepository(), failing);
    const share = await shares.grant({ recipientId: OTHER_USER, resourceType: "paper", resourceId: PAPER });
    assert.equal(share.id, SHARE);
  });

  it("a marker write that throws after a revoke still resolves, and the server revoke stands", async () => {
    const failing = {
      mark: async () => {},
      unmark: async () => {
        throw new Error("database locked");
      },
    };
    const repo = fakeShareRepository();
    const shares = withShareMarks(repo, failing);
    await shares.revoke(SHARE);
    assert.deepEqual(repo.revoked, [SHARE]);
  });
});

describe("GitHub toggle moves the watermark only on disconnect (needs wasm)", () => {
  it("turning GitHub off rewinds the watermark to 0, so skipped rows are read again", async () => {
    const sql = await localSqlDb();
    await sql.exec("update sync_state set watermark = 42");
    const net = server([]);
    await new SyncEngine(sql, net, LOCAL_USER_ID, undefined, async () => true).cycle();
    await new SyncEngine(sql, net, LOCAL_USER_ID, undefined, async () => false).cycle();
    await new SyncEngine(sql, net, LOCAL_USER_ID, undefined, async () => true).cycle();
    const row = await sql.queryOne<{ watermark: number }>("select watermark from sync_state");
    assert.equal(Number(row?.watermark), 0);
  });
});
