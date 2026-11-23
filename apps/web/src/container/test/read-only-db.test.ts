import assert from "node:assert/strict";
import { test } from "node:test";

import { ReadOnlyError, readOnlyDb } from "../read-only-repositories";

/** A db stand-in that counts each call that reaches it, so a test can tell a refused call from a passed one. */
function fakeDb() {
  const calls: string[] = [];
  const builder = (table: string) => ({
    select: (..._args: unknown[]) => (calls.push(`select ${table}`), "rows"),
    insert: (..._args: unknown[]) => (calls.push(`insert ${table}`), "inserted"),
    update: (..._args: unknown[]) => (calls.push(`update ${table}`), "updated"),
    upsert: (..._args: unknown[]) => (calls.push(`upsert ${table}`), "upserted"),
    delete: (..._args: unknown[]) => (calls.push(`delete ${table}`), "deleted"),
  });
  const db = {
    from: (table: string, ..._args: unknown[]) => builder(table),
    rpc: (name: string, ..._args: unknown[]) => (calls.push(`rpc ${name}`), "called"),
  };
  return { db, calls };
}

test("a personal table write through db is refused before it reaches the database", () => {
  const { db, calls } = fakeDb();
  const guarded = readOnlyDb(db);
  assert.throws(() => guarded.from("projects").insert({ name: "x" }), new ReadOnlyError());
  assert.throws(() => guarded.from("papers").update({}), new ReadOnlyError());
  assert.throws(() => guarded.from("papers").upsert({}), new ReadOnlyError());
  assert.throws(() => guarded.from("papers").delete(), new ReadOnlyError());
  assert.deepEqual(calls, [], "no write reached the database");
});

test("an org-server table write through db passes", () => {
  const { db, calls } = fakeDb();
  const guarded = readOnlyDb(db);
  assert.equal(guarded.from("organizations").insert({}), "inserted");
  assert.equal(guarded.from("comments").upsert({}), "upserted");
  assert.deepEqual(calls, ["insert organizations", "upsert comments"]);
});

test("reads through db pass on any table", () => {
  const { db, calls } = fakeDb();
  const guarded = readOnlyDb(db);
  assert.equal(guarded.from("projects").select(), "rows");
  assert.deepEqual(calls, ["select projects"]);
});

test("an rpc that writes a personal table is refused; an org rpc and a read rpc pass", () => {
  const { db, calls } = fakeDb();
  const guarded = readOnlyDb(db);
  assert.throws(() => guarded.rpc("compact_crdt_log", {}), new ReadOnlyError());
  assert.throws(() => guarded.rpc("unlisted_write_fn", {}), new ReadOnlyError());
  assert.equal(guarded.rpc("create_organization_atomic", {}), "called");
  assert.equal(guarded.rpc("api_token_scopes", {}), "called");
  assert.deepEqual(calls, ["rpc create_organization_atomic", "rpc api_token_scopes"]);
});

test("a lab snapshot publish and remove pass: it is what a member shares with the lab", () => {
  const { db, calls } = fakeDb();
  const guarded = readOnlyDb(db);
  assert.equal(guarded.from("lab_snapshots").insert({}), "inserted");
  assert.equal(guarded.from("lab_snapshots").delete(), "deleted");
  assert.deepEqual(calls, ["insert lab_snapshots", "delete lab_snapshots"]);
});

test("compact_crdt_log runs only for a live-share type; a personal or missing type is refused", () => {
  const { db, calls } = fakeDb();
  const guarded = readOnlyDb(db);
  assert.equal(guarded.rpc("compact_crdt_log", { p_resource_type: "experiment" }), "called");
  assert.equal(guarded.rpc("compact_crdt_log", { p_resource_type: "lab_snapshot" }), "called");
  for (const args of [{ p_resource_type: "vault_page" }, { p_resource_type: "note" }, {}, undefined]) {
    assert.throws(() => guarded.rpc("compact_crdt_log", args), new ReadOnlyError(), JSON.stringify(args));
  }
  assert.deepEqual(calls, ["rpc compact_crdt_log", "rpc compact_crdt_log"]);
});

test("projects, user_settings, milestones and experiments refuse insert, update and upsert", () => {
  const { db, calls } = fakeDb();
  const guarded = readOnlyDb(db);
  for (const table of ["projects", "user_settings", "milestones", "experiments"]) {
    assert.throws(() => guarded.from(table).insert({}), new ReadOnlyError(), `${table} insert`);
    assert.throws(() => guarded.from(table).update({}), new ReadOnlyError(), `${table} update`);
    assert.throws(() => guarded.from(table).upsert({}), new ReadOnlyError(), `${table} upsert`);
  }
  assert.deepEqual(calls, [], "no write reached the database");
});

test("an experiment crdt_updates insert passes the guard (live-share relay append)", () => {
  const { db, calls } = fakeDb();
  const guarded = readOnlyDb(db);
  assert.equal(guarded.from("crdt_updates").insert({ resource_type: "experiment" }), "inserted");
  assert.deepEqual(calls, ["insert crdt_updates"]);
});

test("crdt_updates: insert of a live-share type passes; update, upsert and delete are refused", () => {
  const { db, calls } = fakeDb();
  const guarded = readOnlyDb(db);
  for (const type of ["experiment", "lab_snapshot"]) {
    assert.equal(guarded.from("crdt_updates").insert({ resource_type: type }), "inserted", type);
  }
  assert.throws(() => guarded.from("crdt_updates").update({}), new ReadOnlyError(), "update");
  assert.throws(() => guarded.from("crdt_updates").upsert({}), new ReadOnlyError(), "upsert");
  assert.throws(() => guarded.from("crdt_updates").delete(), new ReadOnlyError(), "delete");
  assert.deepEqual(calls, ["insert crdt_updates", "insert crdt_updates"]);
});

test("crdt_updates: a personal resource_type insert is refused before it reaches the database", () => {
  const { db, calls } = fakeDb();
  const guarded = readOnlyDb(db);
  for (const type of ["paper", "vault_page", "reading_list", "report_section", "milestone"]) {
    assert.throws(() => guarded.from("crdt_updates").insert({ resource_type: type }), new ReadOnlyError(), type);
  }
  assert.throws(() => guarded.from("crdt_updates").insert([{ resource_type: "experiment" }, { resource_type: "paper" }]), new ReadOnlyError(), "mixed batch");
  assert.deepEqual(calls, [], "no personal crdt row reached the database");
});

test("crdt_updates delete (deleteUpTo's from().delete()) is refused even for live-share types", () => {
  // No live caller of deleteUpTo exists (only the port, the files-mode wrapper and the
  // Rust planner). Pinned so a future caller in files mode is a deliberate change here.
  const { db, calls } = fakeDb();
  const guarded = readOnlyDb(db);
  // delete() takes no row, so the guard cannot see a resource_type; one refusal covers every type.
  assert.throws(() => guarded.from("crdt_updates").delete(), new ReadOnlyError());
  assert.deepEqual(calls, [], "no crdt delete reached the database");
});

test("a profiles upsert passes the guard (lab-directory saveProfile)", () => {
  const { db, calls } = fakeDb();
  const guarded = readOnlyDb(db);
  assert.equal(guarded.from("profiles").upsert({}), "upserted");
  assert.deepEqual(calls, ["upsert profiles"]);
});
