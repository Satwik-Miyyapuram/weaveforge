import assert from "node:assert/strict";
import { test } from "node:test";

import { readOnlyBackend, readOnlyDb, READ_ONLY_MESSAGE } from "../read-only-repositories";

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
  assert.throws(() => guarded.from("projects").insert({ name: "x" }), new Error(READ_ONLY_MESSAGE));
  assert.throws(() => guarded.from("papers").update({}), new Error(READ_ONLY_MESSAGE));
  assert.throws(() => guarded.from("papers").upsert({}), new Error(READ_ONLY_MESSAGE));
  assert.throws(() => guarded.from("papers").delete(), new Error(READ_ONLY_MESSAGE));
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
  assert.throws(() => guarded.rpc("compact_crdt_log", {}), new Error(READ_ONLY_MESSAGE));
  assert.throws(() => guarded.rpc("unlisted_write_fn", {}), new Error(READ_ONLY_MESSAGE));
  assert.equal(guarded.rpc("create_organization_atomic", {}), "called");
  assert.equal(guarded.rpc("api_token_scopes", {}), "called");
  assert.deepEqual(calls, ["rpc create_organization_atomic", "rpc api_token_scopes"]);
});

test("readOnlyBackend guards db and keeps org writes working", () => {
  const { db, calls } = fakeDb();
  const backend = readOnlyBackend({ db, projectRepository: { create: () => "made" } });
  assert.throws(() => backend.db.from("projects").insert({}), new Error(READ_ONLY_MESSAGE));
  assert.equal(backend.db.from("comments").insert({}), "inserted");
  assert.deepEqual(calls, ["insert comments"]);
});

test("projects, user_settings, milestones and experiments refuse insert, update and upsert", () => {
  const { db, calls } = fakeDb();
  const guarded = readOnlyDb(db);
  for (const table of ["projects", "user_settings", "milestones", "experiments"]) {
    assert.throws(() => guarded.from(table).insert({}), new Error(READ_ONLY_MESSAGE), `${table} insert`);
    assert.throws(() => guarded.from(table).update({}), new Error(READ_ONLY_MESSAGE), `${table} update`);
    assert.throws(() => guarded.from(table).upsert({}), new Error(READ_ONLY_MESSAGE), `${table} upsert`);
  }
  assert.deepEqual(calls, [], "no write reached the database");
});
