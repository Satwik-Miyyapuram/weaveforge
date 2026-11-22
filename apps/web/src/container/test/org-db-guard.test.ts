import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { guardOrgDb } from "../org-db-guard";

function spyDb() {
  const calls: string[] = [];
  const inner = {
    from(table: string) {
      calls.push(`from:${table}`);
      return { select: () => ({ table }) };
    },
    rpc(name: string) {
      calls.push(`rpc:${name}`);
      return { name };
    },
  };
  const db = {
    ...inner,
    schema(name: string) {
      calls.push(`schema:${name}`);
      return inner;
    },
    other: 1,
  };
  return { db, calls };
}

describe("org db guard", () => {
  it("passes org tables and rpcs through to the server db", () => {
    const { db, calls } = spyDb();
    const guarded = guardOrgDb(db);
    assert.deepEqual(guarded.from("share_links").select(), { table: "share_links" });
    assert.deepEqual(guarded.rpc("resolve_share_link"), { name: "resolve_share_link" });
    assert.deepEqual(calls, ["from:share_links", "rpc:resolve_share_link"]);
  });

  it("throws for personal tables and never reaches the server db", () => {
    const { db, calls } = spyDb();
    const guarded = guardOrgDb(db);
    assert.throws(() => guarded.from("papers"), /not allowed on the org server: papers/);
    assert.throws(() => guarded.from("notes"), /not allowed on the org server/);
    assert.throws(() => guarded.rpc("delete_everything"), /not allowed on the org server: delete_everything/);
    assert.deepEqual(calls, []);
  });

  it("reaches every table 0165 keeps live, including the share and integration reads", () => {
    const { db, calls } = spyDb();
    const guarded = guardOrgDb(db);
    const live = [
      "experiments", "experiment_metric_points", "experiment_metric_chunks", "experiment_metric_names",
      "lab_snapshots", "crdt_updates", "profiles", "organizations", "org_memberships", "org_invite_codes",
      "shares", "share_links", "share_link_rate_limits", "blob_objects", "shared_docs", "api_tokens",
      "sdk_inbox", "release_notices", "project_keys", "sync_tables", "sync_tombstones", "user_settings",
      "overleaf_connections", "overleaf_linked_reports", "overleaf_workshop_sessions", "milestones", "projects",
      "comments",
    ];
    for (const t of live) assert.doesNotThrow(() => guarded.from(t), t);
    assert.equal(calls.length, live.length);
  });

  it("blocks the personal tables 0165 archives", () => {
    const { db, calls } = spyDb();
    const guarded = guardOrgDb(db);
    for (const t of ["papers", "notes", "tags", "relations", "pins", "reading_lists", "citation_alerts"]) {
      assert.throws(() => guarded.from(t), /not allowed on the org server/, t);
    }
    assert.deepEqual(calls, []);
  });

  it("leaves other members of the db untouched", () => {
    const { db } = spyDb();
    assert.equal(guardOrgDb(db).other, 1);
  });

  it("guards the clients returned by schema() too", () => {
    const { db, calls } = spyDb();
    const guarded = guardOrgDb(db);
    assert.throws(() => guarded.schema("public").from("papers"), /not allowed on the org server: papers/);
    assert.throws(() => guarded.schema("public").rpc("delete_everything"), /not allowed/);
    assert.deepEqual(guarded.schema("public").from("share_links").select(), { table: "share_links" });
    assert.ok(!calls.includes("from:papers") && !calls.includes("rpc:delete_everything"));
  });
});
