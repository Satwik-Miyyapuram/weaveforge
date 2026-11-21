import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { MetricBudget, MetricPoint } from "@weaveforge/core";
import { NotFoundError } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import { FileExperimentRepository } from "../file-experiment-repo";
import { FileMetricRepository } from "../file-metric-repo";

before(loadTestCore);

const WHOLE: MetricBudget = { maxPoints: 1000 };

async function setup() {
  const fs = new MemoryWorkspaceFs();
  const experiments = new FileExperimentRepository(fs, () => "thesis");
  const repo = new FileMetricRepository(fs, () => "thesis");
  const experiment = async (): Promise<string> => (await experiments.add({ name: "Run" })).id;
  return { fs, repo, experiment };
}

function pt(experimentId: string, over: Partial<MetricPoint> = {}): MetricPoint {
  return { experimentId, metric: "loss", step: 0, value: 1, ...over };
}

async function csvFiles(fs: MemoryWorkspaceFs): Promise<string[]> {
  const out: string[] = [];
  for await (const e of fs.walk("")) if (e.kind === "file" && e.path.endsWith(".csv")) out.push(e.path);
  return out.sort();
}

test("history is empty for an unknown experiment", async () => {
  const { repo } = await setup();
  assert.deepEqual(await repo.history("nope", undefined, WHOLE), []);
});

test("T4: append then history returns the points in step order, wall time kept", async () => {
  const { repo, experiment } = await setup();
  const e1 = await experiment();
  await repo.append([
    pt(e1, { step: 1, value: 0.9, wallTime: "2026-01-01T10:00:00.000Z" }),
    pt(e1, { step: 0, value: 1.0 }),
  ]);
  assert.deepEqual(await repo.history(e1, "loss", WHOLE), [
    pt(e1, { step: 0, value: 1.0 }),
    pt(e1, { step: 1, value: 0.9, wallTime: "2026-01-01T10:00:00.000Z" }),
  ]);
});

test("chunks sit next to the experiment file; the same batch twice writes one chunk", async () => {
  const { fs, repo, experiment } = await setup();
  const e1 = await experiment();
  const batch = [pt(e1, { metric: "Ünïcode, \"acc\"", value: 0.5 })];
  await repo.append(batch);
  await repo.append(batch);
  const files = await csvFiles(fs);
  assert.equal(files.length, 1);
  assert.match(files[0] ?? "", /^thesis\/experiments\/.+\.experiment\/metrics\/main\/l[0-9a-f]{16}\.csv$/);
  assert.equal((await repo.history(e1, "Ünïcode, \"acc\"", WHOLE)).length, 1);
});

test("history filters by metric and scopes to the experiment", async () => {
  const { repo, experiment } = await setup();
  const e1 = await experiment();
  const e2 = await experiment();
  await repo.append([pt(e1), pt(e1, { metric: "acc", value: 0.5 }), pt(e2, { value: 2 })]);
  assert.deepEqual((await repo.history(e1, "acc", WHOLE)).map((p) => p.metric), ["acc"]);
  assert.deepEqual((await repo.history(e2, undefined, WHOLE)).map((p) => p.value), [2]);
});

test("append to an experiment that does not exist is a NotFoundError", async () => {
  const { repo } = await setup();
  await assert.rejects(repo.append([pt("missing")]), NotFoundError);
  await repo.append([]);
});

test("a reduced series keeps its first and last sample; the budget is per metric", async () => {
  const { repo, experiment } = await setup();
  const e1 = await experiment();
  for (const metric of ["loss", "acc"]) {
    await repo.append(Array.from({ length: 200 }, (_, step) => pt(e1, { metric, step, value: step })));
  }
  const loss = await repo.history(e1, "loss", { maxPoints: 10 });
  assert.equal(loss[0]?.step, 0);
  assert.equal(loss.at(-1)?.step, 199);
  const both = await repo.history(e1, undefined, { maxPoints: 10 });
  assert.ok(both.filter((p) => p.metric === "acc").length >= 10);
  assert.ok(both.length <= 24, `got ${both.length}`);
});

test("a broken chunk is skipped, not fatal", async () => {
  const { fs, repo, experiment } = await setup();
  const e1 = await experiment();
  await repo.append([pt(e1)]);
  const [good] = await csvFiles(fs);
  await fs.writeFile(good!.replace(/l[0-9a-f]+\.csv$/, "broken.csv"), "not,a,metric\n\"open");
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal((await repo.history(e1, undefined, WHOLE)).length, 1);
  } finally {
    console.warn = warn;
  }
});

test("latest activity is the newest wall time, only for experiments asked about", async () => {
  const { repo, experiment } = await setup();
  const e1 = await experiment();
  const e2 = await experiment();
  const e3 = await experiment();
  await repo.append([
    pt(e1, { step: 1, wallTime: "2026-01-01T10:00:00.000Z" }),
    pt(e1, { step: 2, wallTime: "2026-01-01T12:00:00.000Z" }),
    pt(e2, { step: 1, wallTime: "2026-01-01T11:00:00.000Z" }),
    pt(e3, { step: 1 }),
  ]);
  const activity = await repo.latestActivityAt([e1, e3, "missing"]);
  assert.deepEqual([...activity.entries()], [[e1, Date.parse("2026-01-01T12:00:00.000Z")]]);
});

test("reads the exporter's chunk shape", async () => {
  const { fs, repo } = await setup();
  await fs.writeFile(
    "thesis/experiments/run-a--e1.experiment.md",
    "---\nweaveforge-id: e1\nweaveforge-type: experiment\ntitle: Run A\nstatus: done\ncreated-at: 2026-01-01T00:00:00Z\n---\n",
  );
  await fs.writeFile(
    "thesis/experiments/run-a--e1.experiment/metrics/main/b7-0011223344556677.csv",
    "run,step,metric,value,time\nmain,3,loss,0.25,2026-01-01T00:00:03Z\n",
  );
  assert.deepEqual(await repo.history("e1", undefined, WHOLE), [
    { experimentId: "e1", metric: "loss", step: 3, value: 0.25, wallTime: "2026-01-01T00:00:03Z" },
  ]);
});
