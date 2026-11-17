import assert from "node:assert/strict";
import { test } from "node:test";

import { restoreSyncTables, syncKeyColumns, type SyncRow, type SyncTable, type SyncTableStore } from "../application/sync-tables";

/**
 * G4: a restore that fails halfway must be retryable. The retry inserts only the
 * folder rows the database does not hold yet; it never duplicates a row, and it
 * refuses a database that holds a row the folder does not have.
 */
function memoryStore(failOnInsert?: number) {
  const data: Partial<Record<SyncTable, SyncRow[]>> = {};
  let inserts = 0;
  const store: SyncTableStore = {
    async isEmpty(table) {
      return (data[table] ?? []).length === 0;
    },
    async keys(table) {
      return (data[table] ?? []).map((row) =>
        Object.fromEntries(syncKeyColumns(table).map((c) => [c, row[c]])),
      );
    },
    async insert(table, rows) {
      inserts += 1;
      if (inserts === failOnInsert) throw new Error("connection dropped");
      data[table] = [...(data[table] ?? []), ...rows];
    },
  };
  return { data, store };
}

const folder = (): Partial<Record<SyncTable, SyncRow[]>> => ({
  projects: [{ id: "p1" }, { id: "p2" }],
  papers: Array.from({ length: 1200 }, (_, i) => ({ id: `paper-${String(i).padStart(4, "0")}` })),
});

test("a restore that failed halfway completes on retry without duplicate rows", async () => {
  const { data, store } = memoryStore(3);
  // Insert 1 is projects, insert 2 is papers chunk 1 (500 rows), insert 3 is papers chunk 2 and fails.
  await assert.rejects(restoreSyncTables(folder(), store), /connection dropped/);
  assert.equal(data.papers?.length, 500, "the first chunk was committed before the failure");

  await restoreSyncTables(folder(), store);
  const ids = (data.papers ?? []).map((r) => r.id);
  assert.equal(ids.length, 1200, "retry inserts the 700 missing papers");
  assert.equal(new Set(ids).size, 1200, "no paper is inserted twice");
  assert.equal(data.projects?.length, 2, "projects are not inserted again");
});

test("a retry does not refuse rows the failed restore itself wrote", async () => {
  const { store } = memoryStore(2);
  await assert.rejects(restoreSyncTables(folder(), store), /connection dropped/);
  await assert.doesNotReject(restoreSyncTables(folder(), store));
});

test("a restore refuses a database that holds a row the folder does not have, and writes nothing", async () => {
  const { data, store } = memoryStore();
  data.papers = [{ id: "local-only" }];
  await assert.rejects(restoreSyncTables(folder(), store), /already has rows/);
  assert.deepEqual(
    (data.papers ?? []).map((r) => r.id),
    ["local-only"],
    "the refusal happens before any insert",
  );
  assert.equal(data.projects, undefined, "no table was written before the refusal");
});

test("composite-key rows already stored are skipped by their whole key", async () => {
  const { data, store } = memoryStore();
  const tables = {
    paper_tags: [
      { paper_id: "a", tag_id: "t1", source: "user" },
      { paper_id: "a", tag_id: "t1", source: "ai" },
    ],
  } as Partial<Record<SyncTable, SyncRow[]>>;
  data.paper_tags = [{ paper_id: "a", tag_id: "t1", source: "user" }];
  await restoreSyncTables(tables, store);
  assert.equal(data.paper_tags?.length, 2, "only the missing (a, t1, ai) row is inserted");
});
