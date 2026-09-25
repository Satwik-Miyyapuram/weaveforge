import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseMetricRepository } from "@/features/experiments/infrastructure/supabase-metric-repository";
import { createLocalClient, type LocalQuery } from "@/backend/providers/local/pglite-client";
import { testDb } from "./pg-test-db";

/**
 * `latest_metric_activity` (migration 0131), against the real schema.
 *
 * The function exists because the aggregate cannot be computed in the client:
 * a per-group MAX needs the whole group, and the server's row cap truncates the
 * response instead of failing it, so the browser's answer is silently *wrong*
 * past the cap. Missing means "not running", and the experiments screen writes
 * `abandoned` on that basis — so which experiments come back is a fact worth
 * testing against both metric stores, not just the one the tests happened to
 * write to.
 *
 * It runs through the local PostgREST-shaped client for the same reason as
 * `crdt-snapshot-watermark.test.ts`: the call under test is the one the app
 * makes.
 */

/** An experiment owned by `owner`, with the metric stores ready to write to. */
async function fixture() {
  const db = await testDb();
  const owner = await db.createUser();
  const other = await db.createUser();

  const metricId = async (name: string): Promise<number> => {
    const [row] = await db.sql<{ id: number }>(
      "select experiment_metric_name_id($1) as id",
      [name],
    );
    return row!.id;
  };

  const experiment = async (user: string, name: string): Promise<string> => {
    const [row] = await db.as(user).sql<{ id: string }>(
      "insert into experiments (user_id, name, status) values ($1, $2, 'running') returning id",
      [user, name],
    );
    return row!.id;
  };

  const repoFor = (user: string) =>
    new SupabaseMetricRepository(
      createLocalClient(db.as(user).sql as LocalQuery) as unknown as SupabaseClient,
    );

  return { db, owner, other, metricId, experiment, repoFor };
}

test("metric activity: the newest point is found in the row store", async () => {
  const { db, owner, metricId, experiment, repoFor } = await fixture();
  const id = await experiment(owner, "Run");
  const loss = await metricId("loss");

  await db.as(owner).sql(
    `insert into experiment_metric_points (experiment_id, user_id, value, wall_time, metric_id, step)
     values ($1, $2, 0.5, '2026-01-01T10:00:00Z', $3, 1),
            ($1, $2, 0.4, '2026-01-01T12:00:00Z', $3, 2)`,
    [id, owner, loss],
  );

  const activity = await repoFor(owner).latestActivityAt([id]);

  assert.equal(activity.size, 1);
  assert.equal(activity.get(id), Date.parse("2026-01-01T12:00:00Z"));
});

test("metric activity: points archived into a chunk still count", async () => {
  // The row store is only the hot tail. Once the rollup has moved settled
  // points into a chunk, the newest sample of a quiet run lives *only* there —
  // and reading the row store alone would report it as having no activity,
  // which the screen turns into `abandoned`.
  const { db, owner, metricId, experiment, repoFor } = await fixture();
  const id = await experiment(owner, "Archived run");
  const loss = await metricId("loss");

  await db.as(owner).sql(
    `insert into experiment_metric_chunks (experiment_id, user_id, metric_id, chunk_no, steps, values, wall_times)
     values ($1, $2, $3, 0,
             array[1, 2, 3], array[0.9, 0.5, 0.4],
             array['2026-02-01T08:00:00Z'::timestamptz, '2026-02-01T09:00:00Z'::timestamptz, '2026-02-01T11:30:00Z'::timestamptz])`,
    [id, owner, loss],
  );

  const activity = await repoFor(owner).latestActivityAt([id]);

  assert.equal(activity.get(id), Date.parse("2026-02-01T11:30:00Z"));
});

test("metric activity: the newer of the two stores wins", async () => {
  // A point can legitimately be in both: a late write for an already-archived
  // step lands in the row store. Either copy's clock is a real observation, so
  // the answer is the later of the two rather than whichever store was read.
  const { db, owner, metricId, experiment, repoFor } = await fixture();
  const id = await experiment(owner, "Both stores");
  const loss = await metricId("loss");

  await db.as(owner).sql(
    `insert into experiment_metric_chunks (experiment_id, user_id, metric_id, chunk_no, steps, values, wall_times)
     values ($1, $2, $3, 0, array[1], array[0.9], array['2026-03-01T08:00:00Z'::timestamptz])`,
    [id, owner, loss],
  );
  await db.as(owner).sql(
    `insert into experiment_metric_points (experiment_id, user_id, value, wall_time, metric_id, step)
     values ($1, $2, 0.8, '2026-03-01T09:30:00Z', $3, 2)`,
    [id, owner, loss],
  );

  const activity = await repoFor(owner).latestActivityAt([id]);

  assert.equal(activity.get(id), Date.parse("2026-03-01T09:30:00Z"));
});

test("metric activity: an experiment with no points is absent, not zero", async () => {
  // Absent is the only spelling the caller knows how to read; a zero would look
  // like a timestamp in 1970 and be treated as long-idle.
  const { owner, experiment, repoFor } = await fixture();
  const id = await experiment(owner, "Never logged");

  const activity = await repoFor(owner).latestActivityAt([id]);

  assert.equal(activity.has(id), false);
});

test("metric activity: rows with no wall clock cannot answer the question", async () => {
  const { db, owner, metricId, experiment, repoFor } = await fixture();
  const id = await experiment(owner, "No clock");
  const loss = await metricId("loss");

  await db.as(owner).sql(
    `insert into experiment_metric_points (experiment_id, user_id, value, wall_time, metric_id, step)
     values ($1, $2, 0.5, null, $3, 1)`,
    [id, owner, loss],
  );

  assert.equal((await repoFor(owner).latestActivityAt([id])).has(id), false);
});

test("metric activity: another user's experiment is not reported", async () => {
  // `security invoker`, so the caller's RLS decides what is visible — the same
  // rule the previous trip through PostgREST applied.
  const { db, owner, other, metricId, experiment, repoFor } = await fixture();
  const mine = await experiment(owner, "Mine");
  const theirs = await experiment(other, "Theirs");
  const loss = await metricId("loss");

  await db.as(other).sql(
    `insert into experiment_metric_points (experiment_id, user_id, value, wall_time, metric_id, step)
     values ($1, $2, 0.5, '2026-04-01T10:00:00Z', $3, 1)`,
    [theirs, other, loss],
  );

  const activity = await repoFor(owner).latestActivityAt([mine, theirs]);

  assert.equal(activity.has(theirs), false, "RLS still scopes the aggregate to the caller");
});

test("metric history: points archived into chunks are read back", async () => {
  // The other half of the same read path. `history` goes through the view, so
  // this is what proves the view is the one being queried after 0114/0115.
  const { db, owner, metricId, experiment, repoFor } = await fixture();
  const id = await experiment(owner, "Curve");
  const loss = await metricId("loss");

  await db.as(owner).sql(
    `insert into experiment_metric_chunks (experiment_id, user_id, metric_id, chunk_no, steps, values, wall_times)
     values ($1, $2, $3, 0, array[1, 2], array[0.9, 0.5],
             array['2026-05-01T08:00:00Z'::timestamptz, '2026-05-01T09:00:00Z'::timestamptz])`,
    [id, owner, loss],
  );

  const history = await repoFor(owner).history(id, "loss", { maxPoints: 100 });

  assert.deepEqual(history.map((p) => p.step), [1, 2]);
  assert.deepEqual(history.map((p) => p.value), [0.9, 0.5]);
});

test("metric history: a long series is reduced where the data lives, not paged into the browser", async () => {
  // The unbudgeted branch this used to take materialised the whole run as JS
  // objects in one array, for a chart a few thousand pixels wide. A budget is now
  // required on the port, so the only way to read 1 200 stored points is to say
  // you can draw 1 200 of them; the server-side stride still keeps the endpoints,
  // so a curve never looks like it started late or stopped early.
  const { db, owner, metricId, experiment, repoFor } = await fixture();
  const id = await experiment(owner, "Long run");
  const loss = await metricId("loss");

  const steps = Array.from({ length: 1200 }, (_, index) => index + 1);
  await db.as(owner).sql(
    `insert into experiment_metric_points (experiment_id, user_id, value, wall_time, metric_id, step)
     select $1, $2, 1.0, now(), $3, s from unnest($4::int[]) as s`,
    [id, owner, loss, `{${steps.join(",")}}`],
  );

  const history = await repoFor(owner).history(id, "loss", { maxPoints: 100 });

  assert.ok(history.length >= 100 && history.length <= 102, `got ${history.length} points`);
  assert.equal(history[0]?.step, 1, "the first sample survives");
  assert.equal(history.at(-1)?.step, 1200, "and so does the last");
});

test("metric history: a budget reduces the series where the data lives", async () => {
  // With a budget the reduction is `metric_history`'s job, so the response is
  // bounded before it crosses the wire rather than after.
  const { db, owner, metricId, experiment, repoFor } = await fixture();
  const id = await experiment(owner, "Big run");
  const loss = await metricId("loss");

  const steps = Array.from({ length: 500 }, (_, index) => index + 1);
  await db.as(owner).sql(
    `insert into experiment_metric_points (experiment_id, user_id, value, wall_time, metric_id, step)
     select $1, $2, 1.0, now(), $3, s from unnest($4::int[]) as s`,
    [id, owner, loss, `{${steps.join(",")}}`],
  );

  const history = await repoFor(owner).history(id, "loss", { maxPoints: 20 });

  assert.ok(history.length >= 20 && history.length <= 22, `got ${history.length} points`);
  assert.equal(history[0]?.step, 1, "the first sample survives");
  assert.equal(history.at(-1)?.step, 500, "and so does the last");
});

test("metric history: a budget above the series length changes nothing", async () => {
  const { db, owner, metricId, experiment, repoFor } = await fixture();
  const id = await experiment(owner, "Short run");
  const loss = await metricId("loss");

  await db.as(owner).sql(
    `insert into experiment_metric_points (experiment_id, user_id, value, wall_time, metric_id, step)
     values ($1, $2, 0.5, now(), $3, 1), ($1, $2, 0.4, now(), $3, 2)`,
    [id, owner, loss],
  );

  const history = await repoFor(owner).history(id, "loss", { maxPoints: 5000 });

  assert.deepEqual(history.map((p) => p.step), [1, 2]);
});

/**
 * The write path, end to end, through the view.
 *
 * `append` has had no production caller since the Python SDK became the writer
 * over the ingest API, which is exactly how it drifted and why a review flagged
 * it twice: one finding said it inserted into a relation that has been a *view*
 * since 0114/0115 and would fail with "cannot insert into a view", another said
 * the method was dead surface to delete. Both readings are wrong, and neither
 * could be settled by reading the adapter — the answer is in the schema.
 *
 * It works because 0114/0115 install `INSTEAD OF INSERT` triggers that route the
 * write into `experiment_metric_points` and fill the columns the view cannot
 * carry: `metric` (text) resolves to `metric_id`, and `user_id` coalesces to
 * `auth.uid()`. This test is what makes that a documented dependency rather than
 * an accident a later migration can quietly remove.
 */
test("metric write: append through the view lands in the row store", async () => {
  const { db, owner, experiment, repoFor } = await fixture();
  const id = await experiment(owner, "Ingest");

  await repoFor(owner).append([
    { experimentId: id, metric: "loss", step: 1, value: 0.9, wallTime: "2026-05-01T08:00:00.000Z" },
    { experimentId: id, metric: "loss", step: 2, value: 0.5, wallTime: "2026-05-01T09:00:00.000Z" },
    { experimentId: id, metric: "acc", step: 1, value: 0.1 },
  ]);

  // 1. The rows are physically in the point table, with the metric *name*
  //    resolved to an id and the owner filled by the trigger.
  const rows = await db.as(owner).sql<{
    metric: string;
    step: number;
    value: number;
    user_id: string;
  }>(
    `select n.name as metric, p.step, p.value, p.user_id
       from experiment_metric_points p
       join experiment_metric_names n on n.id = p.metric_id
      where p.experiment_id = $1
      order by n.name, p.step`,
    [id],
  );

  assert.deepEqual(
    rows.map((r) => [r.metric, r.step, r.value]),
    [["acc", 1, 0.1], ["loss", 1, 0.9], ["loss", 2, 0.5]],
    "metric text resolved to metric_id, step and value preserved",
  );
  assert.ok(
    rows.every((r) => r.user_id === owner),
    "user_id came from the trigger's coalesce(new.user_id, auth.uid())",
  );

  // 2. And the same rows read back through the view the chart uses.
  const loss = await repoFor(owner).history(id, "loss", { maxPoints: 100 });
  assert.deepEqual(loss.map((p) => p.step), [1, 2]);
  assert.deepEqual(loss.map((p) => p.value), [0.9, 0.5]);
  assert.equal(loss[0]?.wallTime, "2026-05-01T08:00:00.000Z", "wall_time survives the round trip");

  // 3. A wall time the caller omitted stays absent rather than becoming epoch 0.
  const acc = await repoFor(owner).history(id, "acc", { maxPoints: 100 });
  assert.equal(acc[0]?.wallTime, undefined);
});

test("metric write: a caller cannot append to an experiment they do not own", async () => {
  // The write path is protected by RLS, not by the view being read-only — and the
  // pairing is worth pinning because reading it the other way is what produced the
  // code audit's contradictory findings about this method.
  //
  // `experiment_metric_points` has an insert policy of `auth.uid() = user_id`, and
  // the view's trigger fills `user_id` with `coalesce(new.user_id, auth.uid())`.
  // Leaving `user_id` out of the payload therefore resolves it to the *caller*, so
  // a non-owner's insert evaluates `other = owner`, which is false, and is refused
  // with SQLSTATE 42501. Same enforcement as `schema-invariants.integration.ts`'s
  // "A3: metrics can only be appended to an experiment the writer owns".
  //
  // The first version of this test asserted the opposite — that the coalesce would
  // stamp the caller and the row would land. It failed, which is the test doing its
  // job; the refusal is the interesting behaviour.
  const { db, other, experiment, metricId, repoFor } = await fixture();
  const owner = await db.createUser();
  const theirs = await experiment(owner, "Theirs");
  await metricId("loss");

  await assert.rejects(
    () => repoFor(other).append([{ experimentId: theirs, metric: "loss", step: 1, value: 0.5 }]),
    (err: { code?: string }) => err.code === "42501",
    "a non-owner's append is refused by the row policy",
  );

  const rows = await db.sql<{ n: number }>(
    "select count(*)::int as n from experiment_metric_points where experiment_id = $1",
    [theirs],
  );
  assert.equal(rows[0]?.n, 0, "and nothing was written");
});
