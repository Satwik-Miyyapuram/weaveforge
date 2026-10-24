import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { testDb } from "../../../backend/test/pg-test-db";
import { localSqlDb } from "./local-sql";

// One database per file, so every id is new.
let nextId = 9100;
function id(): string {
  nextId += 1;
  return `00000000-0000-4000-9000-${String(nextId).padStart(12, "0")}`;
}

/** A device that belongs to `account`, with one project and an empty queue. */
async function adoptedDevice() {
  const db = await testDb();
  await db.sql("delete from sync_outbox");
  const account = await db.createUser();
  await db.sql("update sync_state set account_id = $1, watermark = 0", [account]);
  const project = id();
  await db.as(account).sql("insert into projects (id, user_id, name) values ($1, $2, 'Thesis')", [project, account]);
  await db.sql("delete from sync_outbox");
  const count = async (rowId: string) =>
    Number((await db.sql<{ n: string }>("select count(*) as n from sync_outbox where row_id = $1", [rowId]))[0]?.n);
  return { db, account, project, count };
}

// The query sync_writable_columns ran before it moved to the catalog.
const INFORMATION_SCHEMA_COLUMNS = `
  select coalesce(array_agg(c.column_name::text order by c.ordinal_position), '{}') as cols
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = $1
     and c.is_generated = 'NEVER' and c.is_identity = 'NO'`;

describe("outbox lookups by row", () => {
  it("has an index on (table_name, row_id) over live ops", async () => {
    const db = await localSqlDb();
    try {
      const idx = await db.queryOne<{ indexdef: string }>(
        "select indexdef from pg_indexes where tablename = 'sync_outbox' and indexname = 'sync_outbox_row_idx'",
      );
      assert.ok(idx, "sync_outbox_row_idx is missing");
      assert.match(idx.indexdef, /\(table_name, row_id\)/);
      assert.match(idx.indexdef, /WHERE \(dead_at IS NULL\)/);
    } finally {
      await db.close();
    }
  });
});

describe("sync_backfill", () => {
  it("queues each row once when it runs twice", async () => {
    const { db, account, project, count } = await adoptedDevice();
    const first = await db.sql<{ n: number }>("select sync_backfill($1) as n", [account]);
    assert.ok((first[0]?.n ?? 0) >= 1);
    const second = await db.sql<{ n: number }>("select sync_backfill($1) as n", [account]);
    assert.equal(second[0]?.n, 0);
    assert.equal(await count(project), 1);
  });

  it("skips a row that already has an op waiting", async () => {
    const { db, account, project, count } = await adoptedDevice();
    await db.as(account).sql("update projects set name = 'Renamed' where id = $1", [project]);
    assert.equal(await count(project), 1);
    await db.sql("select sync_backfill($1)", [account]);
    assert.equal(await count(project), 1);
  });

  it("still queues rows that have no op", async () => {
    const { db, account, project, count } = await adoptedDevice();
    const other = id();
    await db.as(account).sql("insert into projects (id, user_id, name) values ($1, $2, 'Second')", [other, account]);
    await db.sql("delete from sync_outbox where row_id = $1", [other]);
    await db.sql("select sync_backfill($1)", [account]);
    assert.equal(await count(project), 1);
    assert.equal(await count(other), 1);
  });
});

describe("sync_writable_columns", () => {
  it("matches the information_schema answer for every public table", async () => {
    const db = await testDb();
    const tables = await db.sql<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by 1",
    );
    assert.ok(tables.length > 10);
    for (const { table_name } of tables) {
      const [want] = await db.sql<{ cols: string[] }>(INFORMATION_SCHEMA_COLUMNS, [table_name]);
      const [got] = await db.sql<{ cols: string[] }>("select sync_writable_columns($1) as cols", [table_name]);
      assert.deepEqual(got?.cols, want?.cols, table_name);
    }
  });

  it("leaves out generated and identity columns", async () => {
    const db = await testDb();
    const [pages] = await db.sql<{ cols: string[] }>("select sync_writable_columns('vault_pages') as cols");
    assert.ok(pages?.cols.includes("body"));
    assert.ok(!pages?.cols.includes("body_preview"));
    const [crdt] = await db.sql<{ cols: string[] }>("select sync_writable_columns('crdt_updates') as cols");
    assert.ok(!crdt?.cols.includes("id"));
  });

  it("leaves out dropped columns and keeps column order", async () => {
    const db = await localSqlDb();
    try {
      await db.exec("create table public.wc_probe (a int, b int, c int generated always as (a + 1) stored, d int)");
      await db.exec("alter table public.wc_probe drop column b");
      const row = await db.queryOne<{ cols: string[] }>("select sync_writable_columns('wc_probe') as cols");
      assert.deepEqual(row?.cols, ["a", "d"]);
    } finally {
      await db.close();
    }
  });

  it("returns an empty list for a table that does not exist", async () => {
    const db = await localSqlDb();
    try {
      const row = await db.queryOne<{ cols: string[] }>("select sync_writable_columns('no_such_table') as cols");
      assert.deepEqual(row?.cols, []);
    } finally {
      await db.close();
    }
  });
});

describe("local 0020 rollback", () => {
  it("drops the index, restores the old functions, and can run twice", async () => {
    const db = await localSqlDb();
    try {
      const rollback = readFileSync(
        new URL("../../../../../../db/migrations-rollback/local-0020_outbox_row_lookups.sql", import.meta.url),
        "utf8",
      );
      // The test database runs one statement per call; each starts at column 0.
      const statements = rollback.split(/\n(?=(?:drop|create) )/);
      for (let run = 0; run < 2; run += 1) {
        for (const statement of statements) await db.exec(statement);
      }
      const idx = await db.queryOne("select 1 from pg_indexes where indexname = 'sync_outbox_row_idx'");
      assert.equal(idx, null);
      const fn = await db.queryOne<{ src: string }>(
        "select prosrc as src from pg_proc where proname = 'sync_writable_columns'",
      );
      assert.match(fn?.src ?? "", /information_schema/);
    } finally {
      await db.close();
    }
  });
});
