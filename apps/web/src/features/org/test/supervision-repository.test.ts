/**
 * The supervisor's batched reads name their columns (32-25) and still map
 * every field the dashboard reads; the dashboard always reads in one batch
 * (03-14).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ISupervisionRepository, Member } from "@weaveforge/core";

import { PostgrestSupervisionRepository } from "../infrastructure/postgrest-supervision-repository";
import { fetchSuperviseeMilestonesAndLogs } from "@/features/dashboard/application/fetch-supervisee-data";

const MILESTONE = {
  id: "m1", title: "T", description: "D", status: "planned", target_date: "2026-11-01",
  dependencies: [{ id: "m0" }], compute: [{ kind: "gpu" }], created_at: "2026-10-01", user_id: "a",
};
const LOG = { id: "l1", entry_date: "2026-10-02", kind: "note", body: "B", links: [{ id: "x" }], created_at: "2026-10-02", user_id: "b" };

function fakeDb(data: unknown[]) {
  const selects: string[] = [];
  const from = () => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    Object.assign(chain, {
      select: (cols: string) => { selects.push(cols); return chain; },
      in: self,
      order: self,
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(ok),
    });
    return chain;
  };
  return { db: { from } as never, selects };
}

test("batched milestones name their columns and keep every field (32-25)", async () => {
  const { db, selects } = fakeDb([MILESTONE]);
  const out = await new PostgrestSupervisionRepository(db).listMilestonesFor(["a", "z"]);
  assert.doesNotMatch(selects[0]!, /\*/);
  assert.match(selects[0]!, /user_id/);
  assert.deepEqual(out.get("a"), [{
    id: "m1", title: "T", description: "D", status: "planned", targetDate: "2026-11-01",
    dependencies: [{ id: "m0" }], compute: [{ kind: "gpu" }], createdAt: "2026-10-01",
  }]);
  assert.deepEqual(out.get("z"), []);
});

test("batched logs name their columns and keep every field (32-25)", async () => {
  const { db, selects } = fakeDb([LOG]);
  const out = await new PostgrestSupervisionRepository(db).listLogsFor(["b"]);
  assert.doesNotMatch(selects[0]!, /\*/);
  assert.match(selects[0]!, /user_id/);
  assert.deepEqual(out.get("b"), [{ id: "l1", entryDate: "2026-10-02", kind: "note", body: "B", links: [{ id: "x" }], createdAt: "2026-10-02" }]);
});

test("no supervisees means no query", async () => {
  const { db, selects } = fakeDb([]);
  assert.equal((await new PostgrestSupervisionRepository(db).listLogsFor([])).size, 0);
  assert.deepEqual(selects, []);
});

const members = [{ id: "a" }, { id: "b" }] as Member[];

test("the dashboard reads the whole team in one batch per kind (03-14)", async () => {
  const calls: string[] = [];
  const repo: ISupervisionRepository = {
    listMilestones: async () => { calls.push("one"); return []; },
    listLogs: async () => { calls.push("one"); return []; },
    listMilestonesFor: async (ids) => { calls.push(`m:${ids.join()}`); return new Map(ids.map((id) => [id, []])); },
    listLogsFor: async (ids) => { calls.push(`l:${ids.join()}`); return new Map(ids.map((id) => [id, []])); },
  };
  const out = await fetchSuperviseeMilestonesAndLogs(repo, members);
  assert.deepEqual(calls.sort(), ["l:a,b", "m:a,b"]);
  assert.equal(out.error, null);
});

test("one failed batch keeps the other and reports the error", async () => {
  const boom = new Error("logs down");
  const repo = {
    listMilestones: async () => [],
    listLogs: async () => [],
    listMilestonesFor: async (ids: readonly string[]) => new Map(ids.map((id) => [id, []])),
    listLogsFor: async () => { throw boom; },
  } as ISupervisionRepository;
  const out = await fetchSuperviseeMilestonesAndLogs(repo, members);
  assert.equal(out.error, boom);
  assert.deepEqual([...out.milestonesByMember.keys()], ["a", "b"]);
  assert.equal(out.logsByMember.size, 0);
});
