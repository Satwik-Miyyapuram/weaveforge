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
    rpc(name: string, _body?: unknown) {
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
      "experiment_metric_points", "experiment_metric_chunks", "experiment_metric_names",
      "lab_snapshots", "crdt_updates", "profiles", "organizations", "org_memberships", "org_invite_codes",
      "shares", "share_links", "share_link_rate_limits", "blob_objects", "shared_docs", "api_tokens",
      "sdk_inbox", "release_notices", "project_keys", "sync_tables", "sync_tombstones", "comments",
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

  it("blocks the personal tables 0165 keeps live (0.9.8 reads none of them)", () => {
    const { db, calls } = spyDb();
    const guarded = guardOrgDb(db);
    const personal = [
      "projects", "user_settings", "milestones", "experiments", "log_entries",
      "overleaf_connections", "overleaf_linked_reports", "overleaf_workshop_sessions",
    ];
    for (const t of personal) assert.throws(() => guarded.from(t), /not allowed on the org server/, t);
    assert.deepEqual(calls, []);
  });

  it("lets the crdt compaction rpc through for a live-share type, with its body", () => {
    const { db, calls } = spyDb();
    const body = { p_resource_type: "experiment", p_resource_id: "e-1" };
    const seen: unknown[] = [];
    const guarded = guardOrgDb({ ...db, rpc: (name: string, b?: unknown) => (seen.push(b), db.rpc(name)) });
    assert.deepEqual(guarded.rpc("compact_crdt_log", body), { name: "compact_crdt_log" });
    assert.deepEqual(calls, ["rpc:compact_crdt_log"]);
    assert.deepEqual(seen, [body]);
  });

  it("refuses the crdt compaction rpc for a personal or missing type before any request", () => {
    const { db, calls } = spyDb();
    const guarded = guardOrgDb(db);
    for (const body of [undefined, {}, { p_resource_type: "vault_page" }, { p_resource_type: "paper" }, { p_resource_type: 1 }]) {
      assert.throws(() => guarded.rpc("compact_crdt_log", body), /not allowed on the org server: compact_crdt_log/, JSON.stringify(body));
    }
    assert.deepEqual(calls, []);
  });

  it("refuses any storage call, read or write, on a bucket that is not an org-server bucket, before any request", () => {
    const opened: string[] = [];
    const bucket = (name: string) => {
      opened.push(name);
      return { upload: () => name, remove: () => name, createSignedUrls: () => name };
    };
    const guarded = guardOrgDb({ ...spyDb().db, storage: { from: bucket } });
    assert.throws(() => guarded.storage.from("paper-images").upload(), /not allowed on the org server: paper-images/);
    assert.throws(() => guarded.storage.from("paper-images").remove(), /not allowed on the org server/);
    assert.throws(() => guarded.storage.from("paper-images").createSignedUrls(), /not allowed on the org server/);
    assert.deepEqual(opened, []);
  });

  it("refuses every storage member but from(), such as emptyBucket and deleteBucket, before any request", () => {
    const reached: string[] = [];
    const storage = {
      from: () => ({}),
      listBuckets: () => reached.push("listBuckets"),
      getBucket: () => reached.push("getBucket"),
      createBucket: () => reached.push("createBucket"),
      updateBucket: () => reached.push("updateBucket"),
      emptyBucket: () => reached.push("emptyBucket"),
      deleteBucket: () => reached.push("deleteBucket"),
    };
    const guarded = guardOrgDb({ ...spyDb().db, storage }).storage as unknown as Record<string, (b?: string) => unknown>;
    for (const m of ["listBuckets", "getBucket", "createBucket", "updateBucket", "emptyBucket", "deleteBucket"]) {
      assert.throws(() => guarded[m]!("paper-images"), /not allowed on the org server/, m);
    }
    assert.deepEqual(reached, []);
  });

  it("refuses the raw rest client, which would skip the allowlist", () => {
    const reached: string[] = [];
    const guarded = guardOrgDb({ ...spyDb().db, rest: { from: (t: string) => reached.push(t) } }) as unknown as Record<string, unknown>;
    assert.throws(() => guarded.rest, /rest not allowed on the org server/);
    assert.deepEqual(reached, []);
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
