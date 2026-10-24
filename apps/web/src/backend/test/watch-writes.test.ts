import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { watchWrites } from "../providers/postgrest/watch-writes";
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

/** A client whose `rpc` answers like PostgREST: a thenable settling with `{ error }`. */
function rpcClient(result: { error: unknown } = { error: null }) {
  const called: string[] = [];
  const db = {
    rpc(fn: string) {
      called.push(fn);
      return { then: (onFulfilled?: (v: unknown) => unknown) => Promise.resolve(result).then(onFulfilled) };
    },
  };
  return { db: db as unknown as SupabaseClient, called };
}

test("an RPC that writes reports the table it writes", async () => {
  // A write done by a database function never passes through `from()`, so the
  // folder mirror and the sync loop did not hear about it.
  const seen: string[] = [];
  const { db } = rpcClient();
  const wrapped = watchWrites(db, (table) => seen.push(table));
  await wrapped.rpc("set_comment_resolved", { p_id: "c1", p_resolved: true });
  await wrapped.rpc("redeem_share_link", { p_token_hash: "x" });
  assert.deepEqual(seen, ["comments", "shares"]);
});

test("a read-only or bookkeeping RPC reports nothing", async () => {
  const seen: string[] = [];
  const { db, called } = rpcClient();
  const wrapped = watchWrites(db, (table) => seen.push(table));
  await wrapped.rpc("metric_history", {});
  await wrapped.rpc("record_blob_access", {});
  assert.deepEqual(seen, []);
  assert.deepEqual(called, ["metric_history", "record_blob_access"], "the call still goes through");
});

test("a failed RPC is not a change", async () => {
  const seen: string[] = [];
  const { db } = rpcClient({ error: { message: "permission denied" } });
  const wrapped = watchWrites(db, (table) => seen.push(table));
  assert.deepEqual(await wrapped.rpc("set_comment_resolved", {}), { error: { message: "permission denied" } });
  assert.deepEqual(seen, []);
});

test("every RPC the app calls is classified as a write or not", async () => {
  // An RPC missing from the list is silently treated as a read, which is the
  // stale-mirror bug this list exists to prevent. Naming every one here makes
  // a new RPC fail this test until someone decides.
  const { RPC_WRITES } = await import("../providers/postgrest/watch-writes");
  const { readdirSync, readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const src = path.resolve(import.meta.dirname, "../..");
  const called = new Set<string>();
  for (const entry of readdirSync(src, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || /[\/]test[\/]?/.test(entry.parentPath + path.sep)) continue;
    const text = readFileSync(path.join(entry.parentPath, entry.name), "utf8");
    for (const match of text.matchAll(/\.rpc(?:<[^>]*>)?\(\s*"([a-z_0-9]+)"/g)) called.add(match[1]!);
  }
  assert.ok(called.size > 10, "the scan found the app's RPC calls");
  const unclassified = [...called].filter((fn) => !Object.hasOwn(RPC_WRITES, fn)).sort();
  assert.deepEqual(unclassified, []);
});
