import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryLabSnapshotRepository } from "../../../src/testing/in-memory-lab-snapshot-repository.js";

test("publishes a freeze and lists by owner", async () => {
  const repository = new InMemoryLabSnapshotRepository();
  const published = await repository.publish({
    title: "Week 12 check-in",
    note: "Ready for review",
    content: {
      milestones: [
        { id: "m1", title: "Draft methods", status: "in_progress", targetDate: "2026-08-01" },
      ],
      logs: [{ id: "l1", entryDate: "2026-07-26", kind: "daily", body: "Ran ablation." }],
    },
  });

  assert.equal(published.title, "Week 12 check-in");
  assert.equal(published.content.milestones.length, 1);
  assert.deepEqual(await repository.listMine(), [published]);
  assert.deepEqual(await repository.listForMember("self"), [published]);
  assert.deepEqual(await repository.listForMember("other"), []);

  await repository.remove(published.id);
  assert.deepEqual(await repository.listMine(), []);
});

test("a publish after a remove does not overwrite a live snapshot (08-02)", async () => {
  const repository = new InMemoryLabSnapshotRepository();
  const content = { milestones: [], logs: [] };
  const a = await repository.publish({ title: "A", content });
  const b = await repository.publish({ title: "B", content });
  await repository.remove(a.id);
  const c = await repository.publish({ title: "C", content });
  assert.notEqual(c.id, b.id);
  assert.equal((await repository.getById(b.id))?.title, "B");
  assert.equal((await repository.listMine()).length, 2);
});
