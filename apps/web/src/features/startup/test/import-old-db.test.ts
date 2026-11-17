import { test } from "node:test";
import assert from "node:assert/strict";
import {
  importOldDb,
  type OldDbDatabase,
  type OldDbProgress,
  type OldDbShell,
} from "../application/import-old-db";

type Row = Record<string, unknown>;

/** A PGlite stand-in: the public tables, their foreign keys, and each table's rows. */
function fakeDb(tables: Record<string, Row[]>, foreignKeys: [child: string, parent: string][] = []) {
  const state = { closed: 0 };
  const db: OldDbDatabase = {
    async query(sql) {
      if (sql.includes("pg_tables"))
        return { rows: Object.keys(tables).map((tablename) => ({ tablename })) };
      if (sql.includes("pg_constraint"))
        return { rows: foreignKeys.map(([child, parent]) => ({ child, parent })) };
      const match = /^SELECT \* FROM "(.*)"$/.exec(sql);
      if (!match) throw new Error(`unexpected sql: ${sql}`);
      return { rows: tables[match[1]!] ?? [] };
    },
    async close() {
      state.closed++;
    },
  };
  return { db, state };
}

/** The shell commands, recording each call. `failing` makes importTable throw for those tables. */
function fakeShell(options: { pending?: boolean; failing?: Set<string> } = {}) {
  const calls: string[] = [];
  const imported: { table: string; rows: unknown[] }[] = [];
  const shell: OldDbShell = {
    async status() {
      calls.push("status");
      return options.pending ?? true;
    },
    async tar() {
      calls.push("tar");
      return Buffer.from([1, 2, 3]).toString("base64");
    },
    async importTable(table, rows) {
      if (options.failing?.has(table)) throw new Error(`disk full on ${table}`);
      calls.push(`import:${table}`);
      imported.push({ table, rows });
      return { table, inserted: rows.length, skipped: 0, alreadyDone: false };
    },
    async finish(tables) {
      calls.push(`finish:${tables.join(",")}`);
    },
  };
  return { shell, calls, imported };
}

/** Runs the import against the fakes, recording what the open step received. */
function run(
  shell: OldDbShell,
  db: OldDbDatabase,
  onProgress?: (progress: OldDbProgress) => void,
) {
  const opened: Uint8Array[] = [];
  const result = importOldDb({
    shell,
    open: async (tar) => {
      opened.push(tar);
      return db;
    },
    onProgress,
  });
  return { result, opened };
}

// notes has no parent; orders references users, so users goes before orders.
const tables = {
  orders: [{ id: 1, user_id: 7 }],
  users: [{ id: 7 }],
  notes: [{ id: 1, body: "a" }],
};
const foreignKeys: [string, string][] = [["orders", "users"]];

test("imports every table parents first, then finishes once after the last table", async () => {
  const { db } = fakeDb(tables, foreignKeys);
  const { shell, calls } = fakeShell();
  const { result, opened } = run(shell, db);

  assert.deepEqual(await result, { imported: true, tables: ["notes", "users", "orders"] });
  assert.deepEqual(calls, [
    "status",
    "tar",
    "import:notes",
    "import:users",
    "import:orders",
    "finish:notes,users,orders",
  ]);
  assert.deepEqual([...opened[0]!], [1, 2, 3]);
});

test("a table failure stops the import: no finish, later tables untouched, database closed", async () => {
  const { db, state } = fakeDb(tables, foreignKeys);
  const { shell, calls } = fakeShell({ failing: new Set(["users"]) });

  await assert.rejects(run(shell, db).result, /disk full on users/);

  assert.ok(!calls.some((call) => call.startsWith("finish")), "finish must not run");
  assert.ok(!calls.includes("import:orders"), "tables after the failure are not imported");
  assert.equal(state.closed, 1);
});

test("a re-run after a failure imports everything again and finishes once", async () => {
  const { db } = fakeDb(tables, foreignKeys);
  const failing = new Set(["users"]);
  const first = fakeShell({ failing });
  await assert.rejects(run(first.shell, db).result, /disk full on users/);

  failing.clear();
  const second = fakeShell({ failing });
  const outcome = await run(second.shell, db).result;

  assert.deepEqual(outcome, { imported: true, tables: ["notes", "users", "orders"] });
  assert.deepEqual(
    second.calls.filter((call) => call.startsWith("finish")),
    ["finish:notes,users,orders"],
  );
  assert.deepEqual(
    second.imported.map((row) => row.table),
    ["notes", "users", "orders"],
  );
});

test("reports table x of y as each table starts", async () => {
  const { db } = fakeDb(tables, foreignKeys);
  const { shell } = fakeShell();
  const progress: OldDbProgress[] = [];

  await run(shell, db, (p) => progress.push(p)).result;

  assert.deepEqual(progress, [
    { table: "notes", index: 1, total: 3 },
    { table: "users", index: 2, total: 3 },
    { table: "orders", index: 3, total: 3 },
  ]);
});

test("nothing pending: no database is opened and nothing is finished", async () => {
  const { db } = fakeDb(tables, foreignKeys);
  const { shell, calls } = fakeShell({ pending: false });
  const { result, opened } = run(shell, db);

  assert.deepEqual(await result, { imported: false });
  assert.deepEqual(calls, ["status"]);
  assert.equal(opened.length, 0);
});

test("bigint and bytea values are sent in their tagged wire form", async () => {
  const { db } = fakeDb({
    blobs: [{ id: 9007199254740993n, data: new Uint8Array([72, 105]), name: "x" }],
  });
  const { shell, imported } = fakeShell();

  await run(shell, db).result;

  assert.deepEqual(imported[0]!.rows, [
    { id: { $bigint: "9007199254740993" }, data: { $bytes: "SGk=" }, name: "x" },
  ]);
});
