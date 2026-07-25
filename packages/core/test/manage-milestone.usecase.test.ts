import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryMilestoneRepository } from "../src/testing/in-memory-milestone-repository.js";
import { ManageMilestoneUseCase } from "../src/features/plan/application/manage-milestone.use-case.js";
import type { Clock, IdGenerator } from "../src/shared/clock.js";

const clock: Clock = { nowIso: () => "2026-06-30T12:00:00.000Z" };
function seqIds(): IdGenerator { let n = 0; return { newId: () => `id-${++n}` }; }
function uc() {
  const repo = new InMemoryMilestoneRepository();
  return { repo, uc: new ManageMilestoneUseCase({ repository: repo, clock, ids: seqIds() }) };
}

test("add applies defaults", async () => {
  const { uc: u } = uc();
  const m = await u.add({ title: "Literature review done" });
  assert.equal(m.status, "planned");
  assert.deepEqual(m.dependencies, []);
  assert.deepEqual(m.compute, []);
});

test("add rejects empty title and bad date", async () => {
  const { uc: u } = uc();
  await assert.rejects(() => u.add({ title: "  " }));
  await assert.rejects(() => u.add({ title: "x", targetDate: "30-06-2026" }));
});

test("add validates dependencies", async () => {
  const { uc: u } = uc();
  await assert.rejects(() =>
    u.add({ title: "x", dependencies: [{ kind: "external" }] }),
  );
  await assert.rejects(() =>
    u.add({ title: "x", dependencies: [{ kind: "experiment" }] }),
  );
  const ok = await u.add({
    title: "x",
    dependencies: [
      { kind: "external", label: "cluster account" },
      { kind: "paper", refId: "p1" },
    ],
  });
  assert.equal(ok.dependencies.length, 2);
});

test("add validates compute", async () => {
  const { uc: u } = uc();
  await assert.rejects(() => u.add({ title: "x", compute: [{ resource: " " }] }));
  await assert.rejects(() => u.add({ title: "x", compute: [{ resource: "A100", count: 0 }] }));
  await assert.rejects(() => u.add({ title: "x", compute: [{ resource: "A100", hours: -1 }] }));
  const ok = await u.add({ title: "x", compute: [{ resource: "A100", count: 4, hours: 200 }] });
  assert.equal(ok.compute[0]?.count, 4);
});

test("setStatus changes only the status", async () => {
  const { uc: u } = uc();
  const m = await u.add({ title: "x", targetDate: "2026-08-01" });
  const r = await u.setStatus(m.id, "in_progress");
  assert.equal(r.status, "in_progress");
  assert.equal(r.targetDate, "2026-08-01");
});

test("update edits fields and clears date with empty string", async () => {
  const { uc: u } = uc();
  const m = await u.add({ title: "x", targetDate: "2026-08-01" });
  const r = await u.update(m.id, {
    title: "y",
    targetDate: "",
    compute: [{ resource: "A100", count: 2 }],
  });
  assert.equal(r.title, "y");
  assert.equal(r.targetDate, undefined);
  assert.equal(r.compute.length, 1);
});

test("update rejects unknown id", async () => {
  const { uc: u } = uc();
  await assert.rejects(() => u.update("nope", { title: "y" }));
});

test("remove deletes the milestone", async () => {
  const { uc: u, repo } = uc();
  const m = await u.add({ title: "x" });
  await u.remove(m.id);
  assert.equal(await repo.getById(m.id), null);
});

test("list sorts by target date, undated last", async () => {
  const { uc: u, repo } = uc();
  await u.add({ title: "b", targetDate: "2026-09-01" });
  await u.add({ title: "a", targetDate: "2026-08-01" });
  await u.add({ title: "c" });
  const items = await repo.list();
  assert.deepEqual(items.map((m) => m.title), ["a", "b", "c"]);
});
