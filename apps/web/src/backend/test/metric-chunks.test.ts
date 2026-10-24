import assert from "node:assert/strict";
import test from "node:test";

import { testDb } from "./pg-test-db";

/**
 * Archived metric points (migration 0115 chunks, fixed in 0144), against the
 * real schema.
 *
 * A point can sit in a chunk, in the row store, or (after a late re-ingest) in
 * both. Removing, updating and re-archiving must each touch exactly that one
 * step, in every place it lives, and leave no copy behind that the view could
 * pick instead.
 */

type Chunk = { chunk_no: number; steps: number[]; values: number[] };

async function fixture() {
  const db = await testDb();
  const owner = await db.createUser();
  const [metric] = await db.sql<{ id: number }>("select experiment_metric_name_id('loss') as id");
  const [exp] = await db.as(owner).sql<{ id: string }>(
    "insert into experiments (user_id, name, status) values ($1, 'Run', 'running') returning id",
    [owner],
  );
  const id = exp!.id;
  const metricId = metric!.id;

  /** Writes a chunk directly, as the rollup would have. */
  const chunk = (chunkNo: number, steps: number[], wallTimes?: (string | null)[]) =>
    db.as(owner).sql(
      `insert into experiment_metric_chunks (experiment_id, user_id, metric_id, chunk_no, steps, values, wall_times)
       values ($1, $2, $3, $4, $5::int[], $6::float8[], $7::timestamptz[])`,
      [id, owner, metricId, chunkNo, steps, steps.map((s) => s / 10), wallTimes ?? steps.map(() => null)],
    );

  const points = (steps: number[], value = (s: number) => s / 10) =>
    db.as(owner).sql(
      `insert into experiment_metrics (experiment_id, metric, step, value)
       select $1, 'loss', s, v from unnest($2::int[], $3::float8[]) as t(s, v)`,
      [id, steps, steps.map(value)],
    );

  const chunks = () =>
    db.sql<Chunk>(
      `select chunk_no, steps, values from experiment_metric_chunks
        where experiment_id = $1 and metric_id = $2 order by chunk_no`,
      [id, metricId],
    );

  const curve = async () =>
    (
      await db.as(owner).sql<{ step: number; value: number }>(
        "select step, value from experiment_metrics where experiment_id = $1 order by step",
        [id],
      )
    ).map((r) => [r.step, r.value]);

  return { db, owner, id, metricId, chunk, points, chunks, curve };
}

test("metric chunks: deleting a step held by two chunks cuts that step from each", async () => {
  // Step 5 sits at position 2 of chunk 0 but position 1 of chunk 1. Cutting
  // chunk 1 at chunk 0's position removed step 6 instead, silently.
  const { db, owner, id, chunk, chunks, curve } = await fixture();
  await chunk(0, [1, 5, 9]);
  await chunk(1, [5, 6]);

  await db.as(owner).sql("delete from experiment_metrics where experiment_id = $1 and step = 5", [id]);

  assert.deepEqual(
    (await chunks()).map((c) => [c.chunk_no, c.steps, c.values]),
    [
      [0, [1, 9], [0.1, 0.9]],
      [1, [6], [0.6]],
    ],
  );
  assert.deepEqual(await curve(), [[1, 0.1], [6, 0.6], [9, 0.9]]);
});

test("metric chunks: deleting the only point of a chunk removes the chunk", async () => {
  // The length check forbids empty arrays, so emptying a chunk in place failed
  // with 23514 and the delete never happened.
  const { db, owner, id, chunk, chunks, curve } = await fixture();
  await chunk(0, [3]);
  await chunk(1, [4, 7]);

  await db.as(owner).sql("delete from experiment_metrics where experiment_id = $1 and step = 3", [id]);

  assert.deepEqual((await chunks()).map((c) => c.chunk_no), [1]);
  assert.deepEqual(await curve(), [[4, 0.4], [7, 0.7]]);
});

test("metric chunks: updating the only point of a chunk moves it to the row store", async () => {
  const { db, owner, id, chunk, chunks, curve } = await fixture();
  await chunk(0, [3]);

  await db.as(owner).sql(
    "update experiment_metrics set value = 9.5 where experiment_id = $1 and step = 3",
    [id],
  );

  assert.deepEqual(await chunks(), []);
  assert.deepEqual(await curve(), [[3, 9.5]]);
});

test("metric chunks: deleting a step that is in no chunk leaves chunks alone", async () => {
  const { db, owner, id, chunk, points, chunks, curve } = await fixture();
  await chunk(0, [1, 2]);
  await points([8]);

  await db.as(owner).sql("delete from experiment_metrics where experiment_id = $1 and step = 8", [id]);

  assert.deepEqual((await chunks()).map((c) => c.steps), [[1, 2]]);
  assert.deepEqual(await curve(), [[1, 0.1], [2, 0.2]]);
});

test("metric chunks: re-archiving a re-ingested step replaces the old archived copy", async () => {
  const { db, points, chunks, curve } = await fixture();
  await points([1, 2, 3, 4, 5, 6]);
  await db.sql("select experiment_metrics_rollup(2, 0)");
  assert.deepEqual((await chunks()).map((c) => c.steps), [[1, 2], [3, 4], [5, 6]]);

  // A late write for archived step 2, plus new steps so the series qualifies.
  await points([2, 7, 8], (s) => (s === 2 ? 2.5 : s / 10));
  await db.sql("select experiment_metrics_rollup(2, 0)");
  await db.sql("select experiment_metrics_rollup(2, 0)");

  const all = (await chunks()).flatMap((c) => c.steps);
  assert.equal(all.filter((s) => s === 2).length, 1, "step 2 archived once");
  assert.equal(new Set(all).size, all.length, "no step archived twice");
  assert.deepEqual(await curve(), [[1, 0.1], [2, 2.5], [3, 0.3], [4, 0.4], [5, 0.5], [6, 0.6], [7, 0.7], [8, 0.8]]);
});

test("metric chunks: re-archiving every step of an old chunk drops that chunk", async () => {
  const { db, points, chunks, curve } = await fixture();
  await points([1, 2, 3]);
  await db.sql("select experiment_metrics_rollup(2, 0)");
  assert.deepEqual((await chunks()).map((c) => [c.chunk_no, c.steps]), [[0, [1, 2]]]);

  await points([1, 2], (s) => s + 10);
  await db.sql("select experiment_metrics_rollup(2, 0)");

  assert.deepEqual((await chunks()).map((c) => [c.chunk_no, c.steps, c.values]), [[1, [1, 2], [11, 12]]]);
  assert.deepEqual(await curve(), [[1, 11], [2, 12], [3, 0.3]]);
});

test("metric chunks: dedupe keeps each step only in its newest chunk", async () => {
  // Production already holds duplicates written by the old rollup; the
  // migration runs this once to clear them.
  const { db, chunk, chunks, curve } = await fixture();
  await chunk(0, [1, 2, 3]);
  await chunk(1, [2]);
  await chunk(2, [3, 4]);
  await chunk(3, [1, 3]);

  await db.sql("select experiment_metric_chunks_dedupe()");

  assert.deepEqual(
    (await chunks()).map((c) => [c.chunk_no, c.steps]),
    [
      [1, [2]],
      [2, [4]],
      [3, [1, 3]],
    ],
  );
  assert.deepEqual(await curve(), [[1, 0.1], [2, 0.2], [3, 0.3], [4, 0.4]]);
  await db.sql("select experiment_metric_chunks_dedupe()");
  assert.equal((await chunks()).length, 3, "running it again changes nothing");
});

test("metric chunks: each chunk records its newest wall time", async () => {
  const { db, id, chunk } = await fixture();
  await chunk(0, [1, 2, 3], ["2026-01-01T10:00:00Z", null, "2026-01-01T09:00:00Z"]);
  await chunk(1, [4], [null]);

  const read = () =>
    db.sql<{ chunk_no: number; max_wall_time: Date | null }>(
      "select chunk_no, max_wall_time from experiment_metric_chunks where experiment_id = $1 order by chunk_no",
      [id],
    );
  let rows = await read();
  assert.equal(rows[0]!.max_wall_time?.toISOString(), "2026-01-01T10:00:00.000Z");
  assert.equal(rows[1]!.max_wall_time, null, "no clock anywhere stays null");

  await db.sql("delete from experiment_metrics where experiment_id = $1 and step = 1", [id]);
  rows = await read();
  assert.equal(rows[0]!.max_wall_time?.toISOString(), "2026-01-01T09:00:00.000Z", "recomputed after a cut");
});

test("metric activity: reads each chunk's newest time instead of expanding its arrays", async () => {
  const { db } = await fixture();
  const [fn] = await db.sql<{ body: string }>(
    "select pg_get_functiondef('latest_metric_activity(uuid[])'::regprocedure) as body",
  );
  assert.match(fn!.body, /max_wall_time/);
  assert.doesNotMatch(fn!.body, /unnest\(c\.wall_times\)/);
});

test("metric chunks: new helpers are not callable by signed-in users", async () => {
  const { db } = await fixture();
  const rows = await db.sql<{ fn: string; role: string; ok: boolean }>(
    `select f as fn, r as role, has_function_privilege(r, f, 'execute') as ok
       from unnest(array['experiment_metric_chunks_dedupe()',
                         'experiment_metric_chunks_supersede(uuid, int, int)']) as f,
            unnest(array['anon', 'authenticated', 'service_role']) as r
      order by f, r`,
  );
  for (const r of rows) assert.equal(r.ok, r.role === "service_role", `${r.role} on ${r.fn}`);
  assert.equal(rows.length, 6);
});
