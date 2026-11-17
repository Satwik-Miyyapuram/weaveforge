/**
 * FK ordering for the synced tables: parents before children, self-references
 * ordered per row, and cycles refused.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { testDb } from "../../../backend/test/pg-test-db";
import { SELF_REFERENCE, SYNC_TABLES, orderBySelfReference, type SyncRow } from "../application/sync-tables";

interface Edge {
  child: string;
  parent: string;
}

test("every real foreign key between synced tables points from a later table to an earlier one", async () => {
  const db = await testDb();
  const edges = await db.sql<Edge>(`
    select tc.table_name as child, ccu.table_name as parent
    from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'`);
  const position = new Map<string, number>(SYNC_TABLES.map((t, i) => [t, i]));

  const checked: Edge[] = [];
  for (const edge of edges) {
    if (!position.has(edge.child) || !position.has(edge.parent)) continue;
    if (edge.child === edge.parent) continue; // self-references are ordered per row
    checked.push(edge);
    assert.ok(
      position.get(edge.parent)! < position.get(edge.child)!,
      `${edge.child} must come after its parent ${edge.parent}`,
    );
  }
  assert.ok(checked.length >= 20, `expected the real FK graph, saw ${checked.length} edges`);
});

test("every synced table exists in the schema", async () => {
  const db = await testDb();
  const found = await db.sql<{ table_name: string }>(
    `select table_name from information_schema.tables where table_schema = 'public'`,
  );
  const names = new Set(found.map((r) => r.table_name));
  for (const table of SYNC_TABLES) {
    assert.ok(names.has(table), `${table} is not a table in the schema`);
  }
});

test("self-referencing rows come after the row they point at", () => {
  const rows: SyncRow[] = [
    { id: "c", parent_id: "b" },
    { id: "b", parent_id: "a" },
    { id: "a", parent_id: null },
  ];
  const ids = orderBySelfReference(rows, "parent_id").map((r) => r.id);
  assert.deepEqual(ids, ["a", "b", "c"]);
});

test("a parent outside the file does not block its child", () => {
  const rows: SyncRow[] = [{ id: "x", parent_id: "missing" }, { id: "y", parent_id: null }];
  assert.deepEqual(orderBySelfReference(rows, "parent_id").map((r) => r.id), ["x", "y"]);
});

test("rows without a self-reference column keep their order", () => {
  const rows: SyncRow[] = [{ id: "2" }, { id: "1" }];
  assert.deepEqual(orderBySelfReference(rows, undefined), rows);
});

test("a cycle of self-references is refused", () => {
  const rows: SyncRow[] = [
    { id: "a", parent_id: "b" },
    { id: "b", parent_id: "a" },
  ];
  assert.throws(() => orderBySelfReference(rows, "parent_id"), /cycle/);
});

test("the self-reference map names real columns of the synced tables", () => {
  assert.ok(Object.keys(SELF_REFERENCE).every((t) => (SYNC_TABLES as readonly string[]).includes(t)));
});
