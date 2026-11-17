import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RestoreRefusedError,
  restoreSyncTables,
  type SyncRow,
  type SyncTable,
  type SyncTableStore,
} from "../application/sync-tables";
import { describeRestoreConflicts } from "../application/workspace-folder-tables";

/**
 * G4: a restore that fails halfway must be retryable. The retry inserts only the
 * folder rows the database does not hold yet; it never duplicates a row, and it
 * refuses a database that holds a row the folder does not have.
 *
 * `reads` records every rows() call, so a test can see which tables were read and
 * which columns were asked for.
 */
function memoryStore(failOnInsert?: number) {
  const data: Partial<Record<SyncTable, SyncRow[]>> = {};
  const reads: { table: SyncTable; columns: readonly string[] }[] = [];
  let inserts = 0;
  const store: SyncTableStore = {
    async isEmpty(table) {
      return (data[table] ?? []).length === 0;
    },
    async rows(table, columns) {
      reads.push({ table, columns });
      return data[table] ?? [];
    },
    async insert(table, rows) {
      inserts += 1;
      if (inserts === failOnInsert) throw new Error("connection dropped");
      data[table] = [...(data[table] ?? []), ...rows];
    },
  };
  return { data, reads, store };
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
  await assert.rejects(
    restoreSyncTables(folder(), store),
    (error) => error instanceof RestoreRefusedError && /already has rows/.test(error.message),
  );
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

test("a stored row with the same key but other content is returned as a conflict and left as stored", async () => {
  const { data, store } = memoryStore();
  data.projects = [{ id: "p1", name: "Renamed locally" }];
  const conflicts = await restoreSyncTables(
    { projects: [{ id: "p1", name: "Folder name" }, { id: "p2", name: "New" }] },
    store,
  );
  assert.deepEqual(conflicts, [{ table: "projects", key: { id: "p1" } }], "the differing row is named by its key");
  assert.deepEqual(
    data.projects,
    [{ id: "p1", name: "Renamed locally" }, { id: "p2", name: "New" }],
    "the stored row is not overwritten; the missing row is inserted",
  );
});

test("identical stored rows are not conflicts", async () => {
  const { store } = memoryStore();
  await restoreSyncTables({ projects: [{ id: "p1", name: "Same" }] }, store);
  assert.deepEqual(
    await restoreSyncTables({ projects: [{ id: "p1", name: "Same" }] }, store),
    [],
  );
});

test("a generated column the database computes is not a content difference", async () => {
  const { data, store } = memoryStore();
  data.paper_tags = [{ paper_id: "a", tag_id: "t1", source: "user", id: "db-generated" }];
  const conflicts = await restoreSyncTables(
    { paper_tags: [{ paper_id: "a", tag_id: "t1", source: "user" }] },
    store,
  );
  assert.deepEqual(conflicts, [], "id is generated by the database and left out of the comparison");
});

// Gap 1 (review): the server stamps every row on insert, so the restored row's stamps never match the folder's.
test("a stored row re-stamped by the server is not a conflict", async () => {
  const { data, store } = memoryStore();
  data.projects = [{ id: "p1", name: "Same", server_seq: 900, row_version: 7 }];
  const conflicts = await restoreSyncTables(
    { projects: [{ id: "p1", name: "Same", server_seq: 5, row_version: 1 }] },
    store,
  );
  assert.deepEqual(conflicts, [], "server_seq and row_version are server bookkeeping, not content");
});

// Gap 1 (review): a column added after the folder was exported exists on the stored row only.
test("a column the stored row has and the folder lacks is not a conflict", async () => {
  const { data, store } = memoryStore();
  data.projects = [{ id: "p1", name: "Same", kind: "note" }];
  const conflicts = await restoreSyncTables({ projects: [{ id: "p1", name: "Same" }] }, store);
  assert.deepEqual(conflicts, [], "only columns present in both rows are compared");
});

test("a real content difference is still a conflict when server stamps are present", async () => {
  const { data, store } = memoryStore();
  data.projects = [{ id: "p1", name: "Renamed locally", server_seq: 900, row_version: 7 }];
  const conflicts = await restoreSyncTables(
    { projects: [{ id: "p1", name: "Folder name", server_seq: 5, row_version: 1 }] },
    store,
  );
  assert.deepEqual(conflicts, [{ table: "projects", key: { id: "p1" } }]);
});

// Gap 3 (review): rows are read only for tables that hold rows, and only the columns compared.
test("a table with no stored rows is not read at all", async () => {
  const { reads, store } = memoryStore();
  await restoreSyncTables(folder(), store);
  assert.deepEqual(reads, [], "an empty database reads no rows");
});

test("a stored table is read for its key and the folder's columns only", async () => {
  const { data, reads, store } = memoryStore();
  data.projects = [{ id: "p1", name: "Same" }];
  await restoreSyncTables(
    { projects: [{ id: "p1", name: "Same", server_seq: 5, row_version: 1 }] },
    store,
  );
  const projectsRead = reads.find((r) => r.table === "projects");
  assert.deepEqual(projectsRead?.columns, ["id", "name"], "server stamps are not read back");
});

// Gap 2 (review): the conflict warning names at most 20 rows and counts the rest.
test("a short conflict list names every row", () => {
  assert.equal(
    describeRestoreConflicts([{ table: "projects", key: { id: "p1" } }]),
    'projects {"id":"p1"}',
  );
});

test("a long conflict list names the first 20 rows and counts the rest", () => {
  const conflicts = Array.from({ length: 25 }, (_, i) => ({ table: "projects" as const, key: { id: `p${i}` } }));
  const text = describeRestoreConflicts(conflicts);
  assert.equal(text.split("; ").length, 21, "20 named rows and one count");
  assert.ok(text.endsWith("and 5 more"), `ends with the count: ${text.slice(-30)}`);
});
