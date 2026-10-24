import { test } from "node:test";
import assert from "node:assert/strict";
import { isOnSamplingGrid } from "@weaveforge/core";
import { ingestMetrics, type SdkDb } from "../ingest";

type Call = { table: string; op: string; arg?: unknown };

/** A PostgREST-shaped stand-in: every builder method chains, awaiting resolves by operation. */
function fakeDb(o: { stored?: number | null; readError?: unknown; deleteError?: unknown } = {}) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      let op = "select";
      let arg: unknown;
      const result = () => {
        if (op === "select") {
          return o.readError
            ? { data: null, error: o.readError }
            : { data: o.stored == null ? [] : [{ step: o.stored }], error: null };
        }
        if (op === "delete") return { error: o.deleteError ?? null };
        return { error: null };
      };
      const q = {
        select: () => ((op = "select"), q),
        insert: (a: unknown) => ((op = "insert"), (arg = a), q),
        delete: () => ((op = "delete"), q),
        update: (a: unknown) => ((op = "update"), (arg = a), q),
        eq: () => q,
        in: () => q,
        order: () => q,
        limit: () => q,
        then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => {
          calls.push({ table, op, arg });
          return Promise.resolve(result()).then(ok, bad);
        },
      };
      return q;
    },
  };
  return { db: db as unknown as SdkDb, calls };
}

let offGrid = 1001;
while (isOnSamplingGrid(offGrid)) offGrid += 1;
const batch = { points: [{ experiment_id: "e1", metric: "loss", step: offGrid + 5000, value: 1 }] };

test("ingestMetrics: a failed max-step read is a sanitised 500 and nothing is written (14-09)", async () => {
  const { db, calls } = fakeDb({ readError: { code: "57014", message: "canceling statement on host db-internal" } });
  const res = await ingestMetrics(db, batch);
  assert.equal(res.status, 500);
  assert.doesNotMatch((await res.json()).error, /db-internal/);
  assert.deepEqual(calls.map((c) => c.op), ["select"]);
});

test("ingestMetrics: deletes the superseded off-grid tip after inserting", async () => {
  const { db, calls } = fakeDb({ stored: offGrid });
  const res = await ingestMetrics(db, batch);
  assert.equal(res.status, 200);
  assert.deepEqual(
    calls.filter((c) => c.table === "experiment_metrics").map((c) => c.op),
    ["select", "insert", "delete"],
  );
});

test("ingestMetrics: a failed stale-tip delete still answers 200 and is logged (14-09)", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const { db } = fakeDb({ stored: offGrid, deleteError: { code: "42501", message: "denied" } });
  const res = await ingestMetrics(db, batch);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).stored, 1);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0]!.arguments[0]), /sdk-metrics/);
});

test("ingestMetrics: a new series reads no tip and deletes nothing", async () => {
  const { db, calls } = fakeDb({ stored: null });
  const res = await ingestMetrics(db, batch);
  assert.equal(res.status, 200);
  assert.ok(!calls.some((c) => c.op === "delete"));
});

for (const body of [null, [], "x", { points: "no" }]) {
  test(`ingestMetrics: 400 for ${JSON.stringify(body)}`, async () => {
    const { db, calls } = fakeDb();
    assert.equal((await ingestMetrics(db, body)).status, 400);
    assert.equal(calls.length, 0);
  });
}
