import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PostgrestClient } from "@supabase/postgrest-js";
import { SHARED_READ_TABLES, guardSharedReadDb } from "../shared-read-guard";

/** A fake client that records what reached it. */
function spyDb() {
  const calls: string[] = [];
  const builder = {
    select: (cols?: string) => (calls.push(`select:${cols}`), builder),
    insert: () => (calls.push("insert"), builder),
    update: () => (calls.push("update"), builder),
    upsert: () => (calls.push("upsert"), builder),
    delete: () => (calls.push("delete"), builder),
    or: (v: string) => (calls.push(`or:${v}`), builder),
  };
  const db = {
    from: (t: string) => (calls.push(`from:${t}`), builder),
    rpc: (n: string) => (calls.push(`rpc:${n}`), builder),
    schema: (n: string) => (calls.push(`schema:${n}`), db),
    auth: { marker: true },
  };
  return { db, calls };
}

describe("guardSharedReadDb", () => {
  it("lists exactly the tables shared_table_source names (crates/wf-core/src/sharing.rs)", () => {
    assert.deepEqual(
      [...SHARED_READ_TABLES].sort(),
      ["experiments", "milestones", "papers", "reading_lists", "report_sections", "vault_pages"],
    );
  });

  it("lets a select on each shared table through", () => {
    for (const t of SHARED_READ_TABLES) {
      const { db, calls } = spyDb();
      const g = guardSharedReadDb(db);
      (g.from(t) as { select(c: string): { or(v: string): unknown } }).select("id").or("id.in.(a)");
      assert.deepEqual(calls, [`from:${t}`, "select:id", "or:id.in.(a)"], t);
    }
  });

  it("refuses every write on a shared table before it reaches the client", () => {
    for (const w of ["insert", "update", "upsert", "delete"]) {
      const { db, calls } = spyDb();
      const b = guardSharedReadDb(db).from("papers") as unknown as Record<string, () => unknown>;
      assert.throws(() => b[w]!(), /Only a shared read is allowed/, w);
      assert.deepEqual(calls, ["from:papers"], w);
    }
  });

  it("refuses a write chained after select() or a filter", () => {
    for (const w of ["insert", "update", "upsert", "delete"]) {
      const { db, calls } = spyDb();
      const g = guardSharedReadDb(db).from("papers") as unknown as { select(c: string): { or(v: string): Record<string, () => unknown> } };
      const filtered = g.select("id").or("id.in.(a)");
      assert.throws(() => filtered[w]!(), /Only a shared read is allowed/, w);
      assert.deepEqual(calls, ["from:papers", "select:id", "or:id.in.(a)"], w);
    }
  });

  it("an awaited select resolves with the client's result", async () => {
    const calls: string[] = [];
    const builder = {
      select: (cols: string) => (calls.push(`select:${cols}`), builder),
      then: (resolve: (v: { data: string[] }) => unknown) => resolve({ data: ["row"] }),
    };
    const db = { from: (t: string) => (calls.push(`from:${t}`), builder) };
    const g = guardSharedReadDb(db).from("papers") as unknown as { select(c: string): PromiseLike<{ data: string[] }> };
    assert.deepEqual(await g.select("id"), { data: ["row"] });
    assert.deepEqual(calls, ["from:papers", "select:id"]);
  });

  it("an awaited select on a real PostgREST client returns the rows", async () => {
    const urls: string[] = [];
    const fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify([{ id: "a" }]), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof globalThis.fetch;
    const g = guardSharedReadDb(new PostgrestClient("http://127.0.0.1:9", { fetch }));
    const { data, error } = await g.from("papers").select("id").or("id.in.(a)");
    assert.equal(error, null);
    assert.deepEqual(data, [{ id: "a" }]);
    assert.equal(urls.length, 1);
    assert.throws(() => (g.from("papers").select("id") as unknown as { delete(): unknown }).delete(), /Only a shared read is allowed/);
  });

  it("refuses any other table, every rpc and schema()", () => {
    const { db, calls } = spyDb();
    const g = guardSharedReadDb(db);
    for (const t of ["notes", "tags", "projects", "user_settings", "comments", "shares", "log_entries"]) {
      assert.throws(() => g.from(t), /not allowed for the shared read/, t);
    }
    assert.throws(() => g.rpc("anything"), /not allowed for the shared read/);
    assert.throws(() => g.schema("legacy_archive"), /not allowed for the shared read/);
    assert.deepEqual(calls, []);
  });

  it("passes symbol-keyed members through unchanged", () => {
    const tag = Symbol("tag");
    const fn = () => "own";
    const g = guardSharedReadDb({ ...spyDb().db, [tag]: fn }) as unknown as Record<symbol, unknown>;
    assert.equal(g[tag], fn);
  });

  it("leaves the plain object methods (toString, constructor) callable", () => {
    const { db } = spyDb();
    const g = guardSharedReadDb(db);
    assert.equal(String(g), "[object Object]");
    assert.equal(g.constructor, Object);
  });

  it("passes auth through", () => {
    const { db } = spyDb();
    assert.equal(guardSharedReadDb(db).auth, db.auth);
  });

  it("refuses storage, functions, realtime and any other method before it reaches the client", () => {
    const reached: string[] = [];
    const db = {
      ...spyDb().db,
      storage: { from: () => reached.push("storage") },
      rest: { from: () => reached.push("rest") },
      functions: { invoke: () => reached.push("functions") },
      realtime: { channel: () => reached.push("realtime") },
      channel: () => reached.push("channel"),
      removeAllChannels: () => reached.push("removeAllChannels"),
    };
    const g = guardSharedReadDb(db) as unknown as Record<string, unknown>;
    for (const key of ["storage", "functions", "realtime", "rest"]) {
      assert.throws(() => g[key], /not allowed for the shared read/, key);
    }
    for (const key of ["channel", "removeAllChannels"]) {
      assert.throws(() => (g[key] as () => unknown)(), /not allowed for the shared read/, key);
    }
    assert.deepEqual(reached, []);
  });
});