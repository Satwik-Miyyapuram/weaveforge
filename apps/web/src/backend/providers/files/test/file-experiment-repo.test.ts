import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { Experiment } from "@weaveforge/core";
import { ExperimentValidationError, NotFoundError } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import { FileExperimentRepository } from "../file-experiment-repo";

before(loadTestCore);

function run(over: Partial<Experiment> = {}): Experiment {
  return {
    id: crypto.randomUUID(),
    name: "Ablation",
    status: "planned",
    config: {},
    metrics: {},
    artifacts: [],
    createdAt: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

function setup() {
  const fs = new MemoryWorkspaceFs();
  return { fs, repo: new FileExperimentRepository(fs, () => "thesis") };
}

test("T4: every field round-trips, unicode included; absent is null", async () => {
  const { repo } = setup();
  const e = run({
    name: "Ünïcode — β-VAE",
    hypothesis: "KL warmup helps",
    status: "running",
    repoUrl: "https://example.org/r",
    commitSha: "abc1234",
    branch: "main",
    runCommand: "python train.py",
    config: { lr: 0.001, layers: [1, 2] },
    metrics: { loss: 0.2 },
    artifacts: ["a.pt"],
    resultNote: "Line 1\nLine 2",
    startedAt: "2026-06-01T01:00:00.000Z",
    relatedPaper: "p1",
  });
  await repo.save(e);
  assert.deepEqual(await repo.getById(e.id), e);
  assert.equal(await repo.getById("nope"), null);
});

test("list filters by status, related paper and name; newest first", async () => {
  const { repo } = setup();
  const a = run({ name: "Alpha run", status: "done", createdAt: "2026-06-01T00:00:00.000Z" });
  const b = run({ name: "beta", relatedPaper: "p1", createdAt: "2026-06-02T00:00:00.000Z" });
  const c = run({ name: "ALPHA two", createdAt: "2026-06-03T00:00:00.000Z" });
  for (const e of [a, b, c]) await repo.save(e);
  assert.deepEqual((await repo.list()).map((e) => e.id), [c.id, b.id, a.id]);
  assert.deepEqual((await repo.list({ status: "done" })).map((e) => e.id), [a.id]);
  assert.deepEqual((await repo.list({ relatedPaper: "p1" })).map((e) => e.id), [b.id]);
  assert.deepEqual((await repo.list({ nameContains: "alpha" })).map((e) => e.id), [c.id, a.id]);
});

test("patch writes only the given fields; an undefined key clears it", async () => {
  const { repo } = setup();
  const e = run({ hypothesis: "h", branch: "dev" });
  await repo.save(e);
  await repo.patch(e.id, { name: "Renamed", hypothesis: undefined });
  const got = await repo.getById(e.id);
  assert.equal(got?.name, "Renamed");
  assert.equal(got?.hypothesis, undefined);
  assert.equal(got?.branch, "dev");
  await assert.rejects(repo.patch("missing", { name: "x" }), NotFoundError);
});

test("add validates and writes; a blank name is an ExperimentValidationError", async () => {
  const { repo } = setup();
  const made = await repo.add({ name: "  New run  " });
  assert.equal(made.status, "planned");
  assert.deepEqual(await repo.getById(made.id), made);
  await assert.rejects(repo.add({ name: "   " }), ExperimentValidationError);
});

test("setStatus stamps start and finish times", async () => {
  const { repo } = setup();
  const e = run();
  await repo.save(e);
  const running = await repo.setStatus(e.id, "running");
  assert.ok(running.startedAt);
  assert.equal(running.finishedAt, undefined);
  const done = await repo.setStatus(e.id, "done");
  assert.ok(done.finishedAt);
  assert.deepEqual(await repo.getById(e.id), done);
  await assert.rejects(repo.setStatus("missing", "done"), NotFoundError);
});

test("recordMetrics merges, addArtifacts dedups in order, setResultNote trims and clears", async () => {
  const { repo } = setup();
  const e = run({ metrics: { loss: 1, acc: 0.5 }, artifacts: ["a"] });
  await repo.save(e);
  assert.deepEqual((await repo.recordMetrics(e.id, { loss: 0.1 })).metrics, { loss: 0.1, acc: 0.5 });
  assert.deepEqual((await repo.addArtifacts(e.id, ["b", "a", "b", "c"])).artifacts, ["a", "b", "c"]);
  assert.equal((await repo.setResultNote(e.id, "  works  ")).resultNote, "works");
  assert.equal((await repo.setResultNote(e.id, "  ")).resultNote, undefined);
  assert.equal((await repo.getById(e.id))?.resultNote, undefined);
});

test("remove and delete move the file to the trash", async () => {
  const { fs, repo } = setup();
  const a = run();
  const b = run();
  await repo.save(a);
  await repo.save(b);
  await repo.remove(a.id);
  await repo.delete(b.id);
  assert.deepEqual(await repo.list(), []);
  for await (const entry of fs.walk("")) {
    if (entry.kind === "file") assert.ok(entry.path.startsWith(".weaveforge/trash/"), entry.path);
  }
});
