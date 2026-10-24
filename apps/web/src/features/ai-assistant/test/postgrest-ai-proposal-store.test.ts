/**
 * The claim is one conditional update (B17, 02-01): pending to executing,
 * and only a caller that gets its row back owns the run.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { PostgrestAiProposalStore } from "@/features/ai-assistant/infrastructure/postgrest-ai-proposal-store";

function fakeDb(result: { data: unknown; error: unknown }) {
  const calls: { op: string; args: unknown[] }[] = [];
  const chain = {
    update: (...args: unknown[]) => { calls.push({ op: "update", args }); return chain; },
    eq: (...args: unknown[]) => { calls.push({ op: "eq", args }); return chain; },
    select: (...args: unknown[]) => { calls.push({ op: "select", args }); return Promise.resolve(result); },
  };
  const db = { from: (table: string) => { calls.push({ op: "from", args: [table] }); return chain; } };
  return { db: db as never, calls };
}

const store = (db: never) => new PostgrestAiProposalStore(db, { requireUserId: async () => "u1" } as never, () => "p1");

test("claimPending moves only a pending row to executing", async () => {
  const { db, calls } = fakeDb({ data: [{ id: "a" }], error: null });
  assert.equal(await store(db).claimPending("a"), true);
  assert.deepEqual(calls[0], { op: "from", args: ["ai_proposals"] });
  const update = calls.find((c) => c.op === "update")!.args[0] as Record<string, unknown>;
  assert.equal(update.status, "executing");
  const filters = calls.filter((c) => c.op === "eq").map((c) => c.args);
  assert.deepEqual(filters, [["id", "a"], ["status", "pending"]]);
});

test("claimPending is false when no row was pending", async () => {
  const { db } = fakeDb({ data: [], error: null });
  assert.equal(await store(db).claimPending("a"), false);
});

test("claimPending surfaces a database error", async () => {
  const { db } = fakeDb({ data: null, error: new Error("denied") });
  await assert.rejects(store(db).claimPending("a"), /denied/);
});
