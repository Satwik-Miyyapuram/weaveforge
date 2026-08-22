import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteRowById, rowById } from "../row-access";

interface Call {
  table: string;
  columns?: string;
  eq?: [string, string];
  deleted?: boolean;
}

function fakeDb(result: { data?: unknown; error?: unknown }): {
  db: SupabaseClient;
  calls: Call[];
} {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table };
      calls.push(call);
      const chain = {
        select(columns: string) {
          call.columns = columns;
          return chain;
        },
        delete() {
          call.deleted = true;
          return chain;
        },
        eq(column: string, value: string) {
          call.eq = [column, value];
          return chain;
        },
        maybeSingle: async () => result,
        then: (resolve: (r: unknown) => unknown) => resolve(result),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

test("a missing row is null, not an error", async () => {
  const { db } = fakeDb({ data: null });
  assert.equal(await rowById(db, "papers", "p1"), null);
});

test("the row comes back as-is, selecting every column by default", async () => {
  const { db, calls } = fakeDb({ data: { id: "p1" } });
  assert.deepEqual(await rowById(db, "papers", "p1"), { id: "p1" });
  assert.deepEqual(calls[0], { table: "papers", columns: "*", eq: ["id", "p1"] });
});

test("an explicit column list is passed through", async () => {
  const { db, calls } = fakeDb({ data: null });
  await rowById(db, "share_links", "s1", "id, access");
  assert.equal(calls[0].columns, "id, access");
});

test("a PostgREST error is thrown rather than swallowed", async () => {
  const { db } = fakeDb({ error: new Error("permission denied") });
  await assert.rejects(() => rowById(db, "papers", "p1"), /permission denied/);
  const del = fakeDb({ error: new Error("permission denied") });
  await assert.rejects(() => deleteRowById(del.db, "papers", "p1"), /permission denied/);
});

test("delete targets exactly the one id", async () => {
  const { db, calls } = fakeDb({});
  await deleteRowById(db, "papers", "p1");
  assert.deepEqual(calls[0], { table: "papers", deleted: true, eq: ["id", "p1"] });
});
