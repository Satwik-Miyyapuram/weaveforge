import { test } from "node:test";
import assert from "node:assert/strict";
import {
  importOldDb,
  importOldDbOnce,
  type OldDbDatabase,
  type OldDbProgress,
  type OldDbShell,
} from "../application/import-old-db";

type Row = Record<string, unknown>;

/**
 * A PGlite stand-in: the public tables, their foreign keys, and each table's rows. Row i sits at
 * ctid (0,i+1); tables in `keyless` have no primary key. `users` are the ids in `auth.users`.
 */
function fakeDb(
  tables: Record<string, Row[]>,
  foreignKeys: [child: string, parent: string][] = [],
  keyless: Set<string> = new Set(),
  users: string[] = [],
) {
  const state = { closed: 0, pages: [] as string[] };
  const db: OldDbDatabase = {
    async query(sql) {
      if (sql.includes("FROM auth.users")) return { rows: users.map((id) => ({ id })) };
      if (sql.includes("pg_tables"))
        return { rows: Object.keys(tables).map((tablename) => ({ tablename })) };
      if (sql.includes("pg_constraint"))
        return { rows: foreignKeys.map(([child, parent]) => ({ child, parent })) };
      if (sql.includes("indisprimary"))
        return {
          rows: Object.keys(tables)
            .filter((t) => !keyless.has(t))
            .map((tablename) => ({ tablename })),
        };
      const match =
        /^SELECT ctid::text AS __wf_ctid, \* FROM "(.*)" WHERE ctid > '\(0,(\d+)\)'::tid ORDER BY ctid LIMIT (\d+)$/.exec(
          sql,
        );
      if (!match) throw new Error(`unexpected sql: ${sql}`);
      const [, table, after, limit] = match;
      state.pages.push(`${table}>${after}`);
      const rows = (tables[table!] ?? [])
        .map((row, i) => ({ __wf_ctid: `(0,${i + 1})`, ...row }))
        .slice(Number(after), Number(after) + Number(limit));
      return { rows };
    },
    async close() {
      state.closed++;
    },
  };
  return { db, state };
}

/** The shell commands, recording each call. `failing` makes importTable throw for those tables. */
function fakeShell(
  options: { pending?: boolean; failing?: Set<string>; tarParts?: number[][] } = {},
) {
  const calls: string[] = [];
  const imported: { table: string; rows: unknown[]; last: boolean }[] = [];
  const shell: OldDbShell = {
    async status() {
      calls.push("status");
      return options.pending ?? true;
    },
    async tarPart(index) {
      calls.push(`tar:${index}`);
      const parts = options.tarParts ?? [[1, 2, 3]];
      return { data: Buffer.from(parts[index]!).toString("base64"), parts: parts.length };
    },
    async importTable(table, rows, last) {
      if (options.failing?.has(table)) throw new Error(`disk full on ${table}`);
      calls.push(`import:${table}`);
      imported.push({ table, rows, last });
      return { table, inserted: rows.length, skipped: 0, alreadyDone: false };
    },
    async finish(tables) {
      calls.push(`finish:${tables.join(",")}`);
    },
  };
  return { shell, calls, imported };
}

/** The sends of public tables, leaving out the `auth.users` send that always comes first. */
function tableSends(imported: { table: string; rows: unknown[]; last: boolean }[]) {
  return imported.filter((send) => send.table !== "auth.users");
}

/** Runs the import against the fakes, recording what the open step received. */
function run(
  shell: OldDbShell,
  db: OldDbDatabase,
  onProgress?: (progress: OldDbProgress) => void,
  sizes: { pageRows?: number; sendChars?: number } = {},
) {
  const opened: Blob[] = [];
  const result = importOldDb({
    shell,
    open: async (tar) => {
      opened.push(tar);
      return db;
    },
    onProgress,
    ...sizes,
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
    "tar:0",
    "import:auth.users",
    "import:notes",
    "import:users",
    "import:orders",
    "finish:auth.users,notes,users,orders",
  ]);
  assert.deepEqual([...new Uint8Array(await opened[0]!.arrayBuffer())], [1, 2, 3]);
});

test("a tar in several parts is fetched in order and joined byte for byte", async () => {
  const { db } = fakeDb({});
  const { shell, calls } = fakeShell({ tarParts: [[1, 2], [3, 4], [5]] });
  const { result, opened } = run(shell, db);

  await result;

  assert.deepEqual(calls.slice(0, 4), ["status", "tar:0", "tar:1", "tar:2"]);
  assert.deepEqual([...new Uint8Array(await opened[0]!.arrayBuffer())], [1, 2, 3, 4, 5]);
});

// Guards: the crash on a big old database, where one table went over as one huge value.
test("a big table is read in pages and sent in parts, only the final send marked last", async () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, body: "x".repeat(20) }));
  const { db, state } = fakeDb({ big: rows });
  const { shell, imported } = fakeShell();

  await run(shell, db, undefined, { pageRows: 3, sendChars: 60 }).result;

  assert.deepEqual(state.pages, ["big>0", "big>3", "big>6"], "each page starts after the last");
  const sends = tableSends(imported);
  assert.ok(sends.length > 2, "the table goes over in several sends");
  assert.deepEqual(
    sends.map((send) => send.last),
    [...sends.slice(1).map(() => false), true],
  );
  assert.deepEqual(
    sends.flatMap((send) => send.rows),
    rows,
    "every row once, in order, without the ctid",
  );
});

test("an empty table still gets one send marked last, so it is recorded as done", async () => {
  const { db } = fakeDb({ empty: [] });
  const { shell, imported } = fakeShell();

  await run(shell, db).result;

  assert.deepEqual(tableSends(imported), [{ table: "empty", rows: [], last: true }]);
});

// Guards: a keyless table split over sends, whose rows a retry would insert twice.
test("a table without a primary key is sent in one call however big it is", async () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ seq: i, body: "x".repeat(20) }));
  const { db } = fakeDb({ log: rows }, [], new Set(["log"]));
  const { shell, imported } = fakeShell();

  await run(shell, db, undefined, { pageRows: 3, sendChars: 60 }).result;

  assert.deepEqual(tableSends(imported), [{ table: "log", rows, last: true }]);
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
    ["finish:auth.users,notes,users,orders"],
  );
  assert.deepEqual(
    second.imported.map((row) => row.table),
    ["auth.users", "notes", "users", "orders"],
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

  assert.deepEqual(tableSends(imported)[0]!.rows, [
    { id: { $bigint: "9007199254740993" }, data: { $bytes: "SGk=" }, name: "x" },
  ]);
});

// Guards: rows owned by the old signed-in account refused by the auth.users foreign key, since
// only public tables went over. Only ids are sent, so the local user already in place is skipped.
test("the old auth.users ids go over first, as ids only, before any table", async () => {
  const { db } = fakeDb(tables, foreignKeys, new Set(), ["local", "account"]);
  const { shell, imported } = fakeShell();

  await run(shell, db).result;

  assert.deepEqual(imported[0], {
    table: "auth.users",
    rows: [{ id: "local" }, { id: "account" }],
    last: true,
  });
});

test("two callers at once share one import: one finish, latest caller gets progress", async () => {
  const { db } = fakeDb(tables, foreignKeys);
  const { shell, calls } = fakeShell();
  const firstSeen: string[] = [];
  const secondSeen: string[] = [];
  const open = async () => db;
  const first = importOldDbOnce({ shell, open, onProgress: (p) => firstSeen.push(p.table) });
  const second = importOldDbOnce({ shell, open, onProgress: (p) => secondSeen.push(p.table) });

  assert.equal(first, second);
  assert.deepEqual(await second, { imported: true, tables: ["notes", "users", "orders"] });
  assert.equal(calls.filter((call) => call.startsWith("finish")).length, 1);
  assert.deepEqual(firstSeen, []);
  assert.deepEqual(secondSeen, ["notes", "users", "orders"]);
});

test("after a failed shared import, the next caller starts a fresh one", async () => {
  const { db } = fakeDb(tables, foreignKeys);
  const failing = new Set(["users"]);
  const { shell, calls } = fakeShell({ failing });
  const open = async () => db;
  await assert.rejects(importOldDbOnce({ shell, open }), /disk full on users/);

  failing.clear();
  assert.deepEqual(await importOldDbOnce({ shell, open }), {
    imported: true,
    tables: ["notes", "users", "orders"],
  });
  assert.equal(calls.filter((call) => call.startsWith("finish")).length, 1);
});
