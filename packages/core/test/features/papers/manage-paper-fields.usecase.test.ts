import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryPaperFieldRepository } from "../../../src/testing/in-memory-paper-field-repository.js";
import { ManagePaperFieldsUseCase } from "../../../src/features/papers/application/manage-paper-fields.use-case.js";
import type { IdGenerator } from "../../../src/shared/clock.js";

function seqIds(): IdGenerator {
  let n = 0;
  return { newId: () => `field-${++n}` };
}

function setup() {
  const fields = new InMemoryPaperFieldRepository();
  const uc = new ManagePaperFieldsUseCase({ fields, ids: seqIds() });
  return { fields, uc };
}

test("define creates a project field in sort order", async () => {
  const { uc } = setup();
  const first = await uc.define({ name: "Method", kind: "text" });
  const second = await uc.define({
    name: "Dataset",
    kind: "select",
    options: ["CIFAR-10", "ImageNet"],
  });
  assert.equal(first.sortOrder, 0);
  assert.equal(second.sortOrder, 1);
  assert.deepEqual(
    (await uc.listDefs()).map((d) => d.name),
    ["Method", "Dataset"],
  );
});

test("rename updates the definition without touching paper values", async () => {
  const { fields, uc } = setup();
  const def = await uc.define({ name: "Venue", kind: "text" });
  await uc.setValue("paper-1", def.id, "NeurIPS");
  const before = await fields.listValuesForPaper("paper-1");
  assert.equal(before.length, 1);
  assert.equal(before[0]!.fieldId, def.id);
  assert.equal(before[0]!.value, "NeurIPS");

  const renamed = await uc.rename(def.id, "Publication venue");
  assert.equal(renamed.name, "Publication venue");
  const after = await fields.listValuesForPaper("paper-1");
  assert.deepEqual(after, before);
});

test("setValue upserts by paper+field and clears empty values", async () => {
  const { uc } = setup();
  const def = await uc.define({ name: "Score", kind: "number" });
  const first = await uc.setValue("paper-1", def.id, 0.91);
  const second = await uc.setValue("paper-1", def.id, 0.95);
  assert.equal(second!.id, first!.id);
  assert.equal(second!.value, 0.95);

  const cleared = await uc.setValue("paper-1", def.id, null);
  assert.equal(cleared, null);
  assert.deepEqual(await uc.listValuesForPaper("paper-1"), []);
});

test("multi_select stores normalized option arrays", async () => {
  const { uc } = setup();
  const def = await uc.define({
    name: "Tags",
    kind: "multi_select",
    options: ["A", "B", "C"],
  });
  const value = await uc.setValue("paper-1", def.id, [" B ", "A", "A"]);
  assert.deepEqual(value!.value, ["B", "A"]);
});

test("define rejects duplicate names case-insensitively", async () => {
  const { uc } = setup();
  await uc.define({ name: "Method", kind: "text" });
  await assert.rejects(() => uc.define({ name: "method", kind: "number" }));
});
