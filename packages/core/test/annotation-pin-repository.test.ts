import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryAnnotationPinRepository } from "../src/testing/in-memory-annotation-pin-repository.js";

test("upserts one pin per paper annotation and queries both directions", async () => {
  const repository = new InMemoryAnnotationPinRepository();
  const first = await repository.save({
    paperId: "paper-1",
    annotationKey: "ann-1",
    reportSectionId: "section-1",
  });
  const moved = await repository.save({
    paperId: "paper-1",
    annotationKey: "ann-1",
    reportSectionId: "section-2",
  });

  assert.equal(moved.id, first.id);
  assert.deepEqual(await repository.listForPaper("paper-1"), [moved]);
  assert.deepEqual(await repository.listForSection("section-1"), []);
  assert.deepEqual(await repository.listForSection("section-2"), [moved]);

  await repository.remove("paper-1", "ann-1");
  assert.deepEqual(await repository.listForProject(), []);
});
