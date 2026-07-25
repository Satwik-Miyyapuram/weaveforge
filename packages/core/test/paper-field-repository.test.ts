import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryPaperFieldRepository } from "../src/testing/in-memory-paper-field-repository.js";

test("paper field repository upserts values and cascades def delete", async () => {
  const repository = new InMemoryPaperFieldRepository();
  await repository.saveDef({
    id: "field-1",
    name: "Method",
    kind: "text",
    options: [],
    sortOrder: 0,
  });
  const first = await repository.setValue({
    paperId: "paper-1",
    fieldId: "field-1",
    value: "VAE",
  });
  const updated = await repository.setValue({
    paperId: "paper-1",
    fieldId: "field-1",
    value: "GAN",
  });
  assert.equal(updated.id, first.id);
  assert.equal(updated.value, "GAN");
  assert.equal((await repository.listValuesForPaper("paper-1")).length, 1);

  await repository.deleteDef("field-1");
  assert.deepEqual(await repository.listDefs(), []);
  assert.deepEqual(await repository.listValuesForProject(), []);
});
