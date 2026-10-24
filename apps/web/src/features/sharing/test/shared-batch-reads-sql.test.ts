/**
 * The batch reads the shared-with-me screen uses filter exactly as the single
 * reads they replace (33-17).
 *
 * Experiments and reading lists are read by id without a project filter, which
 * is what lets a run or list shared from another owner's project resolve. The
 * batch read must not add one, and must chunk like the papers read.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createLocalClient, type LocalQuery } from "@/backend/providers/local/pglite-client";
import { PostgrestExperimentRepository } from "@/features/experiments/infrastructure/postgrest-experiment-repository";
import { PostgrestReadingListRepository } from "@/features/reading-lists/infrastructure/postgrest-reading-list-repository";

function recorder() {
  const sql: string[] = [];
  const run: LocalQuery = async (statement) => {
    sql.push(statement);
    return [] as never;
  };
  const db = createLocalClient(run) as unknown as SupabaseClient;
  return { sql, db };
}

const ctx = { projectId: "p1" };
const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

for (const [name, make] of [
  ["experiments", (db: SupabaseClient) => new PostgrestExperimentRepository(db, ctx)],
  ["reading lists", (db: SupabaseClient) => new PostgrestReadingListRepository(db, ctx)],
] as const) {
  test(`${name}: the batch read filters as the single read does`, async () => {
    const single = recorder();
    await make(single.db).getById("a");
    const batch = recorder();
    await make(batch.db).listByIds(["a", "b"]);

    assert.equal(batch.sql.length, 1);
    assert.match(batch.sql[0]!, /"id" in \(|"id" = any\(/i);
    const scoped = (s: string) => /"project_id" = /.test(s);
    assert.equal(scoped(batch.sql[0]!), scoped(single.sql[0]!));
  });

  test(`${name}: the batch read chunks, and asks nothing for no ids`, async () => {
    const none = recorder();
    assert.deepEqual(await make(none.db).listByIds([]), []);
    assert.equal(none.sql.length, 0);

    const many = recorder();
    await make(many.db).listByIds(ids(201));
    assert.equal(many.sql.length, 2);
  });
}
