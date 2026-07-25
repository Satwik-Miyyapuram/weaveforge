import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryReportSectionRepository } from "../src/testing/in-memory-report-section-repository.js";
import { ManageReportSectionUseCase } from "../src/features/report/application/manage-report-section.use-case.js";
import type { Clock, IdGenerator } from "../src/shared/clock.js";

const clock: Clock = { nowIso: () => "2026-06-24T12:00:00.000Z" };
function seqIds(): IdGenerator {
  let n = 0;
  return { newId: () => `id-${++n}` };
}

function makeUseCase() {
  const repo = new InMemoryReportSectionRepository();
  const uc = new ManageReportSectionUseCase({ repository: repo, clock, ids: seqIds() });
  return { repo, uc };
}

test("add persists a new section", async () => {
  const { repo, uc } = makeUseCase();
  const s = await uc.add({ title: "Method", sectionNo: "3" });
  assert.equal((await repo.getById(s.id))?.title, "Method");
});

test("setStatus updates only the status", async () => {
  const { uc } = makeUseCase();
  const s = await uc.add({ title: "Results" });
  const updated = await uc.setStatus(s.id, "done");
  assert.equal(updated.status, "done");
  assert.equal(updated.title, "Results");
});

test("setProgress updates the word count", async () => {
  const { uc } = makeUseCase();
  const s = await uc.add({ title: "Discussion" });
  const updated = await uc.setProgress(s.id, 1200);
  assert.equal(updated.wordCount, 1200);
});

test("setStatus throws for unknown id", async () => {
  const { uc } = makeUseCase();
  await assert.rejects(() => uc.setStatus("nope", "done"));
});
