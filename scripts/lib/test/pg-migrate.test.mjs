import assert from "node:assert/strict";
import { test } from "node:test";

import { copyTable, cutoverVerdict, rowFingerprintSql, silenceTriggers, tableLoadOrder } from "../pg-migrate.mjs";

/** A pg client that knows two columns, a primary key, and a cursor over `rows`. */
function fakeClient(rows = []) {
  const sql = [];
  let cursor = null;
  return {
    sql,
    async query(text) {
      sql.push(text);
      if (text.includes("information_schema.columns")) return { rows: [{ column_name: "id" }, { column_name: "name" }] };
      if (text.includes("pg_index")) return { rows: [{ attname: "id" }] };
      if (/^\s*declare /i.test(text)) {
        cursor = 0;
        return { rows: [] };
      }
      const fetch = /^\s*fetch (\d+) from/i.exec(text);
      if (fetch) {
        const out = rows.slice(cursor, cursor + Number(fetch[1]));
        cursor += out.length;
        return { rows: out };
      }
      if (/^\s*insert /i.test(text)) return { rowCount: (text.match(/\(\$/g) ?? []).length };
      if (/^\s*select /i.test(text)) return { rows };
      return { rows: [] };
    },
  };
}

test("copyTable reads the source in batches, never the whole table (41-08)", async () => {
  const rows = Array.from({ length: 1201 }, (_, i) => ({ id: i, name: `n${i}` }));
  const source = fakeClient(rows);
  const target = fakeClient();
  const out = await copyTable(source, target, "papers");
  assert.deepEqual(out, { table: "papers", copied: 1201, read: 1201, dropped: [] });
  assert.ok(!source.sql.some((q) => /^\s*select "id"/i.test(q)), "no unbounded select");
  assert.equal(source.sql.filter((q) => /^\s*fetch /i.test(q)).length, 3);
  assert.equal(target.sql.filter((q) => /^\s*insert /i.test(q)).length, 3);
  assert.ok(source.sql.some((q) => /^\s*commit/i.test(q)));
});

test("copyTable on an empty table inserts nothing and closes the cursor (41-08)", async () => {
  const source = fakeClient([]);
  const target = fakeClient();
  const out = await copyTable(source, target, "papers");
  assert.deepEqual(out, { table: "papers", copied: 0, read: 0, dropped: [] });
  assert.equal(target.sql.filter((q) => /^\s*insert /i.test(q)).length, 0);
  assert.ok(source.sql.some((q) => /^\s*commit/i.test(q)));
});

test("copyTable rolls the source back when an insert fails (41-08)", async () => {
  const source = fakeClient([{ id: 1, name: "a" }]);
  const target = fakeClient();
  const query = target.query;
  target.query = async (text, values) => {
    if (/^\s*insert /i.test(text)) throw new Error("boom");
    return query(text, values);
  };
  await assert.rejects(copyTable(source, target, "papers"), /boom/);
  assert.ok(source.sql.some((q) => /^\s*rollback/i.test(q)));
  assert.ok(!source.sql.some((q) => /^\s*commit/i.test(q)));
});

/** A real Postgres in memory, when the desktop workspace has installed one. */
async function pglite() {
  try {
    const { PGlite } = await import("@electric-sql/pglite");
    return new PGlite();
  } catch {
    return null;
  }
}

test("tableLoadOrder keeps tables in a foreign-key cycle, after the rest (41-09)", async (t) => {
  const db = await pglite();
  if (!db) return t.skip("@electric-sql/pglite is not installed");
  t.after(() => db.close());
  await db.exec(`
    create table parent (id int primary key);
    create table child (id int primary key, parent_id int references parent(id));
    create table a (id int primary key, b_id int);
    create table b (id int primary key, a_id int references a(id));
    alter table a add foreign key (b_id) references b(id);
    create table tree (id int primary key, up int references tree(id));
  `);

  const order = await tableLoadOrder(db);

  assert.deepEqual([...order].sort(), ["a", "b", "child", "parent", "tree"]);
  assert.ok(order.indexOf("parent") < order.indexOf("child"));
  assert.deepEqual(order.slice(-2), ["a", "b"], "the cycle loads last");
});

test("silenceTriggers uses replica mode when it may (41-03)", async () => {
  const sql = [];
  const client = { async query(text) { sql.push(text); return { rows: [] }; } };
  assert.equal(await silenceTriggers(client), true);
  assert.ok(sql.includes("set local session_replication_role = replica"));
  assert.ok(!sql.includes("set constraints all deferred"));
});

test("silenceTriggers falls back without aborting the transaction (41-03)", async () => {
  const sql = [];
  let aborted = false;
  const client = {
    async query(text) {
      sql.push(text);
      // Postgres semantics: after a failed statement only a rollback is accepted.
      if (aborted && !/^rollback/.test(text)) throw new Error("current transaction is aborted");
      if (text.startsWith("rollback to savepoint")) aborted = false;
      if (text.includes("session_replication_role")) {
        aborted = true;
        throw new Error("permission denied to set parameter");
      }
      return { rows: [] };
    },
  };

  assert.equal(await silenceTriggers(client), false);
  assert.equal(aborted, false);
  assert.equal(sql.at(-1), "set constraints all deferred");
});

test("rowFingerprintSql: where a NULL sits changes the hash", async (t) => {
  const db = await pglite();
  if (!db) return t.skip("@electric-sql/pglite is not installed");
  await db.exec(`create table a (id int primary key, x text, y text);
    create table b (id int primary key, x text, y text);
    insert into a values (1, null, 'v');
    insert into b values (1, 'v', null);`);
  const hash = async (table) =>
    (await db.query(rowFingerprintSql(table, ["x", "y"], ["id"]))).rows[0].h;
  assert.notEqual(await hash("a"), await hash("b"));
});

test("rowFingerprintSql: a separator inside a value does not collide", async (t) => {
  const db = await pglite();
  if (!db) return t.skip("@electric-sql/pglite is not installed");
  await db.exec(`create table c (id int primary key, x text, y text);
    create table d (id int primary key, x text, y text);
    insert into c values (1, 'p,q', 'r');
    insert into d values (1, 'p', 'q,r');`);
  const hash = async (table) =>
    (await db.query(rowFingerprintSql(table, ["x", "y"], ["id"]))).rows[0].h;
  assert.notEqual(await hash("c"), await hash("d"));
});

test("cutoverVerdict: safe only when nothing failed and isolation was probed", () => {
  assert.equal(cutoverVerdict(0, true).ok, true);
  assert.match(cutoverVerdict(0, true).message, /Safe to cut over/);
  const unprobed = cutoverVerdict(0, false);
  assert.equal(unprobed.ok, false);
  assert.doesNotMatch(unprobed.message, /Safe/);
  assert.match(unprobed.message, /not probed/);
  assert.equal(cutoverVerdict(2, true).ok, false);
  assert.match(cutoverVerdict(2, false).message, /2 check\(s\) failed/);
});
