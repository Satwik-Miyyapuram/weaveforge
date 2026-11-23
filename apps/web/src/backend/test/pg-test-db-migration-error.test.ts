/**
 * A migration that fails in the test database must name its file, so the
 * failure points at the migration rather than at a bare SQL error.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { runMigrations } from "./pg-test-db";

test("a failing migration error names the migration file", async () => {
  const ran: string[] = [];
  const exec = async (sql: string) => {
    if (sql === "broken") throw new Error('relation "missing" does not exist');
    ran.push(sql);
  };
  const migrations = [
    { name: "migrations/0001_ok.sql", sql: "ok" },
    { name: "migrations/0002_broken.sql", sql: "broken" },
    { name: "migrations/0003_never.sql", sql: "never" },
  ];

  await assert.rejects(runMigrations(exec, migrations), (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    assert.match(message, /migrations\/0002_broken\.sql/);
    assert.match(message, /relation "missing" does not exist/);
    return true;
  });
  assert.deepEqual(ran, ["ok"], "migrations after the failing one do not run");
});
