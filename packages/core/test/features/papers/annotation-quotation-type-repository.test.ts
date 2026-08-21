import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryAnnotationQuotationTypeRepository } from "../../../src/testing/in-memory-annotation-quotation-type-repository.js";

test("upserts one quotation type per paper annotation", async () => {
  const repository = new InMemoryAnnotationQuotationTypeRepository();
  const first = await repository.save({
    paperId: "paper-1",
    annotationKey: "ann-1",
    quotationType: "direct",
  });
  const updated = await repository.save({
    paperId: "paper-1",
    annotationKey: "ann-1",
    quotationType: "summary",
  });

  assert.equal(updated.id, first.id);
  assert.equal(updated.quotationType, "summary");
  assert.deepEqual(await repository.listForPaper("paper-1"), [updated]);

  await repository.remove("paper-1", "ann-1");
  assert.deepEqual(await repository.listForPaper("paper-1"), []);
});
