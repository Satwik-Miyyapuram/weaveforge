import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { watchWrites } from "../providers/supabase/watch-writes";
import {
  notifyWorkspaceChange,
  onWorkspaceChange,
  resetWorkspaceChangeListeners,
} from "@/lib/workspace-changes";

/**
 * A stand-in for the PostgREST builder: fluent, thenable, and settling with
 * `{ error }` rather than rejecting, which is the behaviour the wrapper reads.
 */
function fakeClient(result: { error: unknown } = { error: null }) {
  const calls: string[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["insert", "update", "upsert", "delete", "select", "eq", "order"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push(`${method}(${args.map(String).join(",")})`);
      return builder;
    };
  }
  builder.then = (onFulfilled?: (v: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled);
  const db = {
    from(table: string) {
      calls.push(`from(${table})`);
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

function watched(result?: { error: unknown }) {
  const seen: string[] = [];
  const { db, calls } = fakeClient(result);
  return { db: watchWrites(db, (table) => seen.push(table)), seen, calls };
}

test("a write reports the table it wrote to", async () => {
  const { db, seen } = watched();
  await db.from("papers").insert({ id: "p1" });
  assert.deepEqual(seen, ["papers"]);
});

test("update, upsert and delete all count as writes", async () => {
  const { db, seen } = watched();
  await db.from("notes").update({ title: "x" });
  await db.from("notes").upsert({ id: "n1" });
  await db.from("notes").delete();
  assert.deepEqual(seen, ["notes", "notes", "notes"]);
});

test("a read reports nothing", async () => {
  const { db, seen } = watched();
  await db.from("papers").select("*");
  await db.from("papers").select("*").eq("id", "p1");
  assert.deepEqual(seen, []);
});

test("the report survives the rest of the chain", async () => {
  const { db, seen } = watched();
  // PostgREST answers a write with `.insert(...).select().eq(...)`, so the
  // object finally awaited is several builders past the mutation itself.
  await db.from("papers").insert({ id: "p1" }).select("*").eq("id", "p1");
  assert.deepEqual(seen, ["papers"]);
});

test("a failed write is not a change", async () => {
  const { db, seen } = watched({ error: { message: "row level security" } });
  await db.from("papers").insert({ id: "p1" });
  assert.deepEqual(seen, []);
});

test("the wrapper does not disturb the call it wraps", async () => {
  const { db, calls } = watched();
  const result = await db.from("papers").insert({ id: "p1" }).select("*");
  assert.deepEqual(result, { error: null });
  assert.deepEqual(calls, ["from(papers)", "insert([object Object])", "select(*)"]);
});

test("a listener that throws does not fail the write", async () => {
  const { db } = fakeClient();
  const wrapped = watchWrites(db, () => {
    throw new Error("listener exploded");
  });
  assert.deepEqual(await wrapped.from("papers").insert({ id: "p1" }), { error: null });
});

test("listeners hear a change, and stop when they unsubscribe", () => {
  resetWorkspaceChangeListeners();
  const heard: string[] = [];
  const off = onWorkspaceChange((table) => heard.push(table));
  notifyWorkspaceChange("papers");
  off();
  notifyWorkspaceChange("notes");
  assert.deepEqual(heard, ["papers"]);
});

test("one listener throwing does not deafen the others", () => {
  resetWorkspaceChangeListeners();
  const heard: string[] = [];
  onWorkspaceChange(() => {
    throw new Error("first listener exploded");
  });
  onWorkspaceChange((table) => heard.push(table));
  notifyWorkspaceChange("papers");
  assert.deepEqual(heard, ["papers"]);
  resetWorkspaceChangeListeners();
});
