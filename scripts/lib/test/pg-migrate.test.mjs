import assert from "node:assert/strict";
import { test } from "node:test";

import { copyTable } from "../pg-migrate.mjs";

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
