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

test("setStatus refuses a status outside the known set and saves nothing", async () => {
  const { repo } = setup();
  const e = run({ status: "planned" });
  await repo.save(e);
  await assert.rejects(repo.setStatus(e.id, "bogus" as never), ExperimentValidationError);
  assert.equal((await repo.getById(e.id))?.status, "planned");
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

test("delete moves the experiment's metrics folder to the trash with it", async () => {
  const { fs, repo } = setup();
  const a = run({ name: "Run A" });
  const other = run({ name: "Run B" });
  await repo.save(a);
  await repo.save(other);
  const paths: string[] = [];
  for await (const e of fs.walk("thesis")) if (e.kind === "file") paths.push(e.path);
  const fileOf = (slug: string) => paths.find((p) => p.includes(`/${slug}`))!;
  const chunk = `${fileOf("run-a").replace(/\.md$/, "")}/metrics/main/b1.csv`;
  const kept = `${fileOf("run-b").replace(/\.md$/, "")}/metrics/main/b1.csv`;
  await fs.writeFile(chunk, "run,step,metric,value\nmain,0,loss,1\n");
  await fs.writeFile(kept, "run,step,metric,value\nmain,0,loss,2\n");
  await repo.delete(a.id);
  const left: string[] = [];
  for await (const e of fs.walk("")) if (e.kind === "file") left.push(e.path);
  assert.ok(!left.includes(chunk), "the chunk left its folder");
  assert.ok(left.some((p) => p.startsWith(".weaveforge/trash/") && p.endsWith(chunk)), left.join("\n"));
  assert.ok(left.includes(kept), "another experiment's metrics stay");
});

/** An fs where another window or app deletes files while remove() is running. */
class RacyFs extends MemoryWorkspaceFs {
  vanishOnWalk: string | null = null;
  vanishOnRename: string | null = null;
  lockedOnRename: string | null = null;
  brokenWalk: string | null = null;
  override async *walk(path: string): ReturnType<MemoryWorkspaceFs["walk"]> {
    if (path === this.brokenWalk) throw new Error("EIO: walk failed");
    if (path === this.vanishOnWalk) {
      await this.remove(path, { recursive: true });
      throw new Error("ENOENT: folder gone");
    }
    yield* super.walk(path);
  }
  override async rename(from: string, to: string): Promise<void> {
    if (from === this.lockedOnRename) throw new Error("EACCES: locked");
    if (from === this.vanishOnRename) {
      await this.remove(from);
      throw new DOMException("gone", "NotFoundError");
    }
    return super.rename(from, to);
  }
}

async function racySetup() {
  const fs = new RacyFs();
  const repo = new FileExperimentRepository(fs, () => "thesis");
  const e = run({ name: "Run A" });
  await repo.save(e);
  let file = "";
  for await (const entry of fs.walk("thesis")) if (entry.kind === "file") file = entry.path;
  const folder = file.replace(/\.md$/, "");
  await fs.writeFile(`${folder}/metrics/main/b1.csv`, "run,step,metric,value\n");
  await fs.writeFile(`${folder}/metrics/main/b2.csv`, "run,step,metric,value\n");
  const files = async () => {
    const out: string[] = [];
    for await (const entry of fs.walk("")) if (entry.kind === "file") out.push(entry.path);
    return out;
  };
  return { fs, repo, e, file, folder, files };
}

test("0.9.8: a metrics folder deleted during remove()'s walk still trashes the experiment", async () => {
  const { fs, repo, e, file, folder, files } = await racySetup();
  fs.vanishOnWalk = folder;
  await repo.remove(e.id);
  const left = await files();
  assert.ok(!left.includes(file), "the .md left its folder");
  assert.ok(left.some((p) => p.startsWith(".weaveforge/trash/") && p.endsWith(file)), left.join("\n"));
});

test("0.9.8: a walk that fails while the folder is still there is thrown, and nothing moves", async () => {
  const { fs, repo, e, file, folder } = await racySetup();
  fs.brokenWalk = folder;
  await assert.rejects(repo.remove(e.id), /EIO/);
  assert.ok(await fs.stat(file), "the .md stays");
  assert.ok(await fs.stat(`${folder}/metrics/main/b1.csv`), "the metrics stay");
});

test("0.9.8: a metrics file deleted before its trash move is skipped; the rest is trashed", async () => {
  const { fs, repo, e, file, folder, files } = await racySetup();
  fs.vanishOnRename = `${folder}/metrics/main/b1.csv`;
  await repo.remove(e.id);
  const left = await files();
  assert.ok(left.every((p) => p.startsWith(".weaveforge/trash/")), left.join("\n"));
  assert.ok(left.some((p) => p.endsWith(file)), "the .md is in the trash");
  assert.ok(left.some((p) => p.endsWith(`${folder}/metrics/main/b2.csv`)), "the other chunk is in the trash");
});

test("0.9.8: a trash move that fails on a file still there is not swallowed", async () => {
  const { fs, repo, e, folder } = await racySetup();
  fs.lockedOnRename = `${folder}/metrics/main/b1.csv`;
  await assert.rejects(repo.remove(e.id), /EACCES/);
  // The .md stays until its folder is trashed, so a retry still finds the experiment.
  assert.ok(await repo.getById(e.id), "the experiment is still there to retry");
  fs.lockedOnRename = null;
  await repo.remove(e.id);
  assert.equal(await repo.getById(e.id), null);
  assert.equal(await fs.stat(`${folder}/metrics/main/b1.csv`), null);
});
